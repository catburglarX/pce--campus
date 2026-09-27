/**
 * Mess endpoints: the weekly menu, one day's meals with the student's own rating, submitting a rating,
 * and the seven day trend the dashboard draws.
 */

import { jsonResponse, readJsonBody } from "../http";
import type { RequestContext, Route } from "../router";
import { assertCsrfToken, requireActor, requireAdmin } from "../middleware/guard";
import { collegeDate, weekdayName } from "../domain/calendar";
import { MEAL_LABELS, MEALS, type Meal } from "../domain/rating";
import {
  deleteMyRating,
  getDaySnapshot,
  getRatingTrend,
  getWeeklyMenu,
  listRatingsForDay,
  rateMeal,
  setMenuItems,
} from "../services/mess";
import { recordAuditEntry } from "../services/audit";
import {
  optionalInteger,
  optionalString,
  requireBoolean,
  requireEnum,
  requireId,
  requireInteger,
  requireIsoDate,
  requireString,
} from "../validate";

function handleWeek(context: RequestContext): Response {
  requireActor(context);
  const entries = getWeeklyMenu();
  const days = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    weekdayName: weekdayName(weekday),
    meals: MEALS.map((meal) => ({
      meal,
      label: MEAL_LABELS[meal],
      items: entries.find((entry) => entry.weekday === weekday && entry.meal === meal)?.items ?? "",
    })),
  }));
  return jsonResponse({ days, mealLabels: MEAL_LABELS });
}

function handleDay(context: RequestContext): Response {
  const actor = requireActor(context);
  const requested = context.url.searchParams.get("date");
  const date = requested ? requireIsoDate(requested, "Date") : collegeDate();
  return jsonResponse({
    ...getDaySnapshot(actor.id, date),
    weekdayName: weekdayName(new Date(`${date}T00:00:00Z`).getUTCDay()),
    mealLabels: MEAL_LABELS,
  });
}

async function handleRate(context: RequestContext): Promise<Response> {
  const actor = requireActor(context);
  assertCsrfToken(context);
  const body = await readJsonBody(context.request);
  const saved = rateMeal(actor.id, {
    servedOn: requireIsoDate(body.servedOn, "Served date"),
    meal: requireEnum<Meal>(body.meal, "Meal", MEALS),
    stars: requireInteger(body.stars, "Overall stars", { min: 1, max: 5 }),
    taste: optionalInteger(body.taste, "Taste", { min: 1, max: 5 }),
    hygiene: optionalInteger(body.hygiene, "Hygiene", { min: 1, max: 5 }),
    quantity: optionalInteger(body.quantity, "Quantity", { min: 1, max: 5 }),
    comment: optionalString(body.comment, "Comment", 1000),
    isAnonymous: requireBoolean(body.isAnonymous),
  });
  return jsonResponse({ rating: saved }, 201);
}

function handleDeleteRating(context: RequestContext): Response {
  const actor = requireActor(context);
  assertCsrfToken(context);
  deleteMyRating(actor.id, requireId(context.params.id, "Rating id"));
  return jsonResponse({ deleted: true });
}

function handleDayRatings(context: RequestContext): Response {
  const actor = requireActor(context);
  const date = requireIsoDate(context.url.searchParams.get("date") ?? collegeDate(), "Date");
  const mealParameter = context.url.searchParams.get("meal");
  const meal = mealParameter ? requireEnum<Meal>(mealParameter, "Meal", MEALS) : undefined;
  return jsonResponse({ date, meal: meal ?? null, ratings: listRatingsForDay(date, actor.id, meal) });
}

function handleTrend(context: RequestContext): Response {
  requireActor(context);
  const days = optionalInteger(context.url.searchParams.get("days"), "Days", { min: 2, max: 60 }) ?? 7;
  return jsonResponse({ days, points: getRatingTrend(days) });
}

async function handleMenuUpdate(context: RequestContext): Promise<Response> {
  const actor = requireAdmin(context);
  assertCsrfToken(context);
  const body = await readJsonBody(context.request);
  const weekday = requireInteger(body.weekday, "Weekday", { min: 0, max: 6 });
  const meal = requireEnum<Meal>(body.meal, "Meal", MEALS);
  const entry = setMenuItems(weekday, meal, requireString(body.items, "Menu items", { min: 2, max: 400 }));
  recordAuditEntry(actor.id, "mess.menu_updated", "mess_menu", weekday, `${weekdayName(weekday)} ${meal}`);
  return jsonResponse({ entry });
}

export const messRoutes: Route[] = [
  { method: "GET", pattern: "/api/mess/week", handler: handleWeek },
  { method: "GET", pattern: "/api/mess/day", handler: handleDay },
  { method: "GET", pattern: "/api/mess/ratings", handler: handleDayRatings },
  { method: "POST", pattern: "/api/mess/ratings", handler: handleRate },
  { method: "DELETE", pattern: "/api/mess/ratings/:id", handler: handleDeleteRating },
  { method: "GET", pattern: "/api/mess/trend", handler: handleTrend },
  { method: "PUT", pattern: "/api/mess/menu", handler: handleMenuUpdate },
];
