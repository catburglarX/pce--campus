/**
 * Numbers for the dashboard.
 *
 * Every average is computed in SQL and rounded once through the domain helper, so the dashboard and the
 * category pages cannot disagree about a score.
 */

import type { SQLQueryBindings } from "bun:sqlite";

import { getDb } from "../db/connection";
import { collegeDate, shiftDate } from "../domain/calendar";
import { roundToOneDecimal, starDistribution, type StarCount } from "../domain/rating";
import { getMealAggregates, getRatingTrend, type MealAggregate, type TrendPoint } from "./mess";

export type CategoryScore = {
  slug: string;
  name: string;
  icon: string;
  reviewCount: number;
  averageStars: number | null;
  openComplaints: number;
};

export type ActivityItem = {
  kind: "review" | "complaint" | "mess" | "notice";
  title: string;
  detail: string;
  stars: number | null;
  authorName: string;
  createdAt: string;
};

export type Overview = {
  today: string;
  studentCount: number;
  reviewCount: number;
  messRatingCount: number;
  openComplaintCount: number;
  resolvedComplaintCount: number;
  overallAverageStars: number | null;
  messAverageLastWeek: number | null;
  starSpread: StarCount[];
  categoryScores: CategoryScore[];
  todayMeals: MealAggregate[];
  messTrend: TrendPoint[];
  recentActivity: ActivityItem[];
};

function scalar(sql: string, bindings: SQLQueryBindings[] = []): number {
  const row = getDb().query<{ value: number }, SQLQueryBindings[]>(sql).get(...bindings);
  return row?.value ?? 0;
}

function nullableScalar(sql: string, bindings: SQLQueryBindings[] = []): number | null {
  const row = getDb().query<{ value: number | null }, SQLQueryBindings[]>(sql).get(...bindings);
  return roundToOneDecimal(row?.value ?? null);
}

function readCategoryScores(): CategoryScore[] {
  return getDb()
    .query<
      { slug: string; name: string; icon: string; review_count: number; avg_stars: number | null; open_complaints: number },
      []
    >(
      `SELECT categories.slug, categories.name, categories.icon,
              COUNT(reviews.id) AS review_count,
              AVG(reviews.stars) AS avg_stars,
              (SELECT COUNT(*) FROM complaints
                WHERE complaints.category_id = categories.id AND complaints.status IN ('open', 'in_progress'))
                AS open_complaints
         FROM categories
         LEFT JOIN reviews ON reviews.category_id = categories.id AND reviews.status = 'visible'
        GROUP BY categories.id
        ORDER BY categories.sort_order, categories.name`,
    )
    .all()
    .map((row) => ({
      slug: row.slug,
      name: row.name,
      icon: row.icon,
      reviewCount: row.review_count,
      averageStars: roundToOneDecimal(row.avg_stars),
      openComplaints: row.open_complaints,
    }));
}

function readRecentActivity(limit: number): ActivityItem[] {
  const reviews = getDb()
    .query<{ title: string; detail: string; stars: number; author: string; created_at: string; anon: number }, [number]>(
      `SELECT reviews.title AS title, categories.name AS detail, reviews.stars AS stars,
              users.name AS author, reviews.created_at AS created_at, reviews.is_anonymous AS anon
         FROM reviews JOIN users ON users.id = reviews.user_id
         JOIN categories ON categories.id = reviews.category_id
        WHERE reviews.status = 'visible' ORDER BY reviews.created_at DESC LIMIT ?`,
    )
    .all(limit)
    .map((row) => ({
      kind: "review" as const,
      title: row.title,
      detail: row.detail,
      stars: row.stars,
      authorName: row.anon === 1 ? "Anonymous student" : row.author,
      createdAt: row.created_at,
    }));

  const complaints = getDb()
    .query<{ title: string; detail: string; author: string; created_at: string; anon: number }, [number]>(
      `SELECT complaints.title AS title, complaints.status AS detail, users.name AS author,
              complaints.created_at AS created_at, complaints.is_anonymous AS anon
         FROM complaints JOIN users ON users.id = complaints.user_id
        ORDER BY complaints.created_at DESC LIMIT ?`,
    )
    .all(limit)
    .map((row) => ({
      kind: "complaint" as const,
      title: row.title,
      detail: `status: ${row.detail.replace("_", " ")}`,
      stars: null,
      authorName: row.anon === 1 ? "Anonymous student" : row.author,
      createdAt: row.created_at,
    }));

  const meals = getDb()
    .query<{ meal: string; served_on: string; stars: number; author: string; created_at: string; anon: number }, [number]>(
      `SELECT mess_ratings.meal AS meal, mess_ratings.served_on AS served_on, mess_ratings.stars AS stars,
              users.name AS author, mess_ratings.updated_at AS created_at, mess_ratings.is_anonymous AS anon
         FROM mess_ratings JOIN users ON users.id = mess_ratings.user_id
        ORDER BY mess_ratings.updated_at DESC LIMIT ?`,
    )
    .all(limit)
    .map((row) => ({
      kind: "mess" as const,
      title: `${row.meal} on ${row.served_on}`,
      detail: "mess rating",
      stars: row.stars,
      authorName: row.anon === 1 ? "Anonymous student" : row.author,
      createdAt: row.created_at,
    }));

  return [...reviews, ...complaints, ...meals]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

export function getOverview(): Overview {
  const today = collegeDate();
  const weekStart = shiftDate(today, -6);
  const allStars = getDb()
    .query<{ stars: number }, []>("SELECT stars FROM reviews WHERE status = 'visible'")
    .all()
    .map((row) => row.stars);
  return {
    today,
    studentCount: scalar("SELECT COUNT(*) AS value FROM users WHERE is_active = 1"),
    reviewCount: scalar("SELECT COUNT(*) AS value FROM reviews WHERE status = 'visible'"),
    messRatingCount: scalar("SELECT COUNT(*) AS value FROM mess_ratings"),
    openComplaintCount: scalar(
      "SELECT COUNT(*) AS value FROM complaints WHERE status IN ('open', 'in_progress')",
    ),
    resolvedComplaintCount: scalar("SELECT COUNT(*) AS value FROM complaints WHERE status = 'resolved'"),
    overallAverageStars: nullableScalar("SELECT AVG(stars) AS value FROM reviews WHERE status = 'visible'"),
    messAverageLastWeek: nullableScalar("SELECT AVG(stars) AS value FROM mess_ratings WHERE served_on >= ?", [
      weekStart,
    ]),
    starSpread: starDistribution(allStars),
    categoryScores: readCategoryScores(),
    todayMeals: getMealAggregates(today),
    messTrend: getRatingTrend(7),
    recentActivity: readRecentActivity(12),
  };
}

export type MyActivity = {
  reviewCount: number;
  messRatingCount: number;
  complaintCount: number;
  helpfulReceived: number;
  averageStarsGiven: number | null;
};

export function getMyActivity(userId: number): MyActivity {
  return {
    reviewCount: scalar("SELECT COUNT(*) AS value FROM reviews WHERE user_id = ?", [userId]),
    messRatingCount: scalar("SELECT COUNT(*) AS value FROM mess_ratings WHERE user_id = ?", [userId]),
    complaintCount: scalar("SELECT COUNT(*) AS value FROM complaints WHERE user_id = ?", [userId]),
    helpfulReceived: scalar(
      `SELECT COUNT(*) AS value FROM review_votes
         JOIN reviews ON reviews.id = review_votes.review_id WHERE reviews.user_id = ?`,
      [userId],
    ),
    averageStarsGiven: nullableScalar("SELECT AVG(stars) AS value FROM reviews WHERE user_id = ?", [userId]),
  };
}
