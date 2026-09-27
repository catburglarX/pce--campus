/**
 * Mess menu and meal ratings.
 *
 * A rating belongs to a student, a served date and a meal. The UNIQUE constraint on those three columns
 * makes re-rating an update rather than a second vote, so one student cannot move the average twice.
 */

import { getDb } from "../db/connection";
import { config } from "../config";
import { notFound, validationError } from "../errors";
import { collegeDate, dateSeriesEndingAt, daysBetween, isoTimestamp, weekdayOf } from "../domain/calendar";
import { MEALS, type Meal, roundToOneDecimal } from "../domain/rating";
import { mealRatingWindow } from "../domain/access-rules";

export type MenuEntry = { weekday: number; meal: Meal; items: string; updatedAt: string };

export type MealAggregate = {
  meal: Meal;
  ratingCount: number;
  averageStars: number | null;
  averageTaste: number | null;
  averageHygiene: number | null;
  averageQuantity: number | null;
};

export type MealRating = {
  id: number;
  meal: Meal;
  servedOn: string;
  stars: number;
  taste: number | null;
  hygiene: number | null;
  quantity: number | null;
  comment: string;
  isAnonymous: boolean;
  authorName: string;
  isMine: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RateMealInput = {
  servedOn: string;
  meal: Meal;
  stars: number;
  taste: number | null;
  hygiene: number | null;
  quantity: number | null;
  comment: string;
  isAnonymous: boolean;
};

type MenuRow = { weekday: number; meal: Meal; items: string; updated_at: string };

type RatingRow = {
  id: number;
  user_id: number;
  served_on: string;
  meal: Meal;
  stars: number;
  taste: number | null;
  hygiene: number | null;
  quantity: number | null;
  comment: string;
  is_anonymous: number;
  created_at: string;
  updated_at: string;
  author_name: string;
};

type AggregateRow = {
  meal: Meal;
  rating_count: number;
  avg_stars: number | null;
  avg_taste: number | null;
  avg_hygiene: number | null;
  avg_quantity: number | null;
};

function toMealRating(row: RatingRow, viewerId: number): MealRating {
  const anonymous = row.is_anonymous === 1;
  return {
    id: row.id,
    meal: row.meal,
    servedOn: row.served_on,
    stars: row.stars,
    taste: row.taste,
    hygiene: row.hygiene,
    quantity: row.quantity,
    comment: row.comment,
    isAnonymous: anonymous,
    authorName: anonymous ? "Anonymous student" : row.author_name,
    isMine: row.user_id === viewerId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getWeeklyMenu(): MenuEntry[] {
  return getDb()
    .query<MenuRow, []>("SELECT weekday, meal, items, updated_at FROM mess_menu ORDER BY weekday")
    .all()
    .map((row) => ({ weekday: row.weekday, meal: row.meal, items: row.items, updatedAt: row.updated_at }));
}

export function setMenuItems(weekday: number, meal: Meal, items: string): MenuEntry {
  getDb().run(
    `INSERT INTO mess_menu (weekday, meal, items, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (weekday, meal) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at`,
    [weekday, meal, items, isoTimestamp()],
  );
  const row = getDb()
    .query<MenuRow, [number, string]>(
      "SELECT weekday, meal, items, updated_at FROM mess_menu WHERE weekday = ? AND meal = ?",
    )
    .get(weekday, meal);
  if (!row) throw notFound("Menu entry");
  return { weekday: row.weekday, meal: row.meal, items: row.items, updatedAt: row.updated_at };
}

export function getMealAggregates(servedOn: string): MealAggregate[] {
  const rows = getDb()
    .query<AggregateRow, [string]>(
      `SELECT meal, COUNT(*) AS rating_count, AVG(stars) AS avg_stars, AVG(taste) AS avg_taste,
              AVG(hygiene) AS avg_hygiene, AVG(quantity) AS avg_quantity
         FROM mess_ratings WHERE served_on = ? GROUP BY meal`,
    )
    .all(servedOn);
  const byMeal = new Map(rows.map((row) => [row.meal, row]));
  return MEALS.map((meal) => {
    const row = byMeal.get(meal);
    return {
      meal,
      ratingCount: row?.rating_count ?? 0,
      averageStars: roundToOneDecimal(row?.avg_stars ?? null),
      averageTaste: roundToOneDecimal(row?.avg_taste ?? null),
      averageHygiene: roundToOneDecimal(row?.avg_hygiene ?? null),
      averageQuantity: roundToOneDecimal(row?.avg_quantity ?? null),
    };
  });
}

export function listRatingsForDay(servedOn: string, viewerId: number, meal?: Meal): MealRating[] {
  const db = getDb();
  const sql = `SELECT mess_ratings.*, users.name AS author_name
                 FROM mess_ratings JOIN users ON users.id = mess_ratings.user_id
                WHERE mess_ratings.served_on = ?${meal ? " AND mess_ratings.meal = ?" : ""}
                ORDER BY mess_ratings.updated_at DESC`;
  const rows = meal
    ? db.query<RatingRow, [string, string]>(sql).all(servedOn, meal)
    : db.query<RatingRow, [string]>(sql).all(servedOn);
  return rows.map((row) => toMealRating(row, viewerId));
}

export function findMyRating(userId: number, servedOn: string, meal: Meal): MealRating | null {
  const row = getDb()
    .query<RatingRow, [number, string, string]>(
      `SELECT mess_ratings.*, users.name AS author_name
         FROM mess_ratings JOIN users ON users.id = mess_ratings.user_id
        WHERE mess_ratings.user_id = ? AND mess_ratings.served_on = ? AND mess_ratings.meal = ?`,
    )
    .get(userId, servedOn, meal);
  return row ? toMealRating(row, userId) : null;
}

/** Upserts the student's rating for that meal on that day, after checking the rating window. */
export function rateMeal(userId: number, input: RateMealInput): MealRating {
  const today = collegeDate();
  const verdict = mealRatingWindow(
    { servedOn: input.servedOn, today, backdateDays: config.messRatingBackdateDays },
    daysBetween(today, input.servedOn),
  );
  if (!verdict.allowed) throw validationError(verdict.reason, "servedOn");

  const now = isoTimestamp();
  getDb().run(
    `INSERT INTO mess_ratings
       (user_id, served_on, meal, stars, taste, hygiene, quantity, comment, is_anonymous, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, served_on, meal) DO UPDATE SET
       stars = excluded.stars, taste = excluded.taste, hygiene = excluded.hygiene,
       quantity = excluded.quantity, comment = excluded.comment,
       is_anonymous = excluded.is_anonymous, updated_at = excluded.updated_at`,
    [
      userId,
      input.servedOn,
      input.meal,
      input.stars,
      input.taste,
      input.hygiene,
      input.quantity,
      input.comment,
      input.isAnonymous ? 1 : 0,
      now,
      now,
    ],
  );
  const saved = findMyRating(userId, input.servedOn, input.meal);
  if (!saved) throw new Error(`Rating upsert for user ${userId} on ${input.servedOn} read back empty`);
  return saved;
}

export function deleteMyRating(userId: number, ratingId: number): void {
  const changes = getDb().run("DELETE FROM mess_ratings WHERE id = ? AND user_id = ?", [ratingId, userId])
    .changes;
  if (changes === 0) throw notFound("Your rating for that meal");
}

export type MessDaySnapshot = {
  date: string;
  weekday: number;
  isToday: boolean;
  canRate: boolean;
  meals: {
    meal: Meal;
    menuItems: string;
    aggregate: MealAggregate;
    myRating: MealRating | null;
  }[];
};

export function getDaySnapshot(userId: number, date: string): MessDaySnapshot {
  const weekday = weekdayOf(date);
  const today = collegeDate();
  const menu = new Map(
    getWeeklyMenu()
      .filter((entry) => entry.weekday === weekday)
      .map((entry) => [entry.meal, entry.items]),
  );
  const aggregates = new Map(getMealAggregates(date).map((aggregate) => [aggregate.meal, aggregate]));
  const window = mealRatingWindow(
    { servedOn: date, today, backdateDays: config.messRatingBackdateDays },
    daysBetween(today, date),
  );
  return {
    date,
    weekday,
    isToday: date === today,
    canRate: window.allowed,
    meals: MEALS.map((meal) => ({
      meal,
      menuItems: menu.get(meal) ?? "Menu not published",
      aggregate: aggregates.get(meal) as MealAggregate,
      myRating: findMyRating(userId, date, meal),
    })),
  };
}

export type TrendPoint = { date: string; averageStars: number | null; ratingCount: number };

export function getRatingTrend(days: number): TrendPoint[] {
  const dates = dateSeriesEndingAt(collegeDate(), days);
  const rows = getDb()
    .query<{ served_on: string; avg_stars: number; rating_count: number }, [string]>(
      `SELECT served_on, AVG(stars) AS avg_stars, COUNT(*) AS rating_count
         FROM mess_ratings WHERE served_on >= ? GROUP BY served_on`,
    )
    .all(dates[0] as string);
  const byDate = new Map(rows.map((row) => [row.served_on, row]));
  return dates.map((date) => ({
    date,
    averageStars: roundToOneDecimal(byDate.get(date)?.avg_stars ?? null),
    ratingCount: byDate.get(date)?.rating_count ?? 0,
  }));
}
