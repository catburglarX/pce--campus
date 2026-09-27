/**
 * Review endpoints. Every write passes through assertCsrfToken and then a service that re-checks
 * ownership on the record itself, never on the route alone.
 */

import { jsonResponse, readJsonBody } from "../http";
import type { RequestContext, Route } from "../router";
import { assertCsrfToken, requireActor } from "../middleware/guard";
import { listCategories } from "../services/categories";
import {
  createReview,
  deleteReview,
  getReview,
  listReviews,
  updateReview,
  type ReviewInput,
  type ReviewSort,
} from "../services/reviews";
import {
  addComment,
  deleteComment,
  flagReview,
  listComments,
  toggleHelpfulVote,
} from "../services/review-interactions";
import {
  optionalString,
  requireBoolean,
  requireEnum,
  requireId,
  requireInteger,
  requireString,
} from "../validate";

const SORTS = ["recent", "helpful", "highest", "lowest"] as const;
const MAX_PAGE_SIZE = 50;

function readReviewInput(body: Record<string, unknown>): ReviewInput {
  return {
    categoryId: requireId(body.categoryId, "Category"),
    subject: optionalString(body.subject, "What or who this is about", 120),
    title: requireString(body.title, "Title", { min: 4, max: 120 }),
    body: requireString(body.body, "Review", { min: 10, max: 4000 }),
    stars: requireInteger(body.stars, "Stars", { min: 1, max: 5 }),
    isAnonymous: requireBoolean(body.isAnonymous),
  };
}

function handleList(context: RequestContext): Response {
  const actor = requireActor(context);
  const parameters = context.url.searchParams;
  const requestedSize = Number(parameters.get("pageSize") ?? 10);
  const page = listReviews({
    viewer: actor,
    categorySlug: parameters.get("category") ?? undefined,
    search: parameters.get("q")?.trim() || undefined,
    sort: requireEnum<ReviewSort>(parameters.get("sort") ?? "recent", "Sort", SORTS),
    mineOnly: parameters.get("mine") === "1",
    page: Math.max(1, Number(parameters.get("page") ?? 1) || 1),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, requestedSize || 10)),
  });
  return jsonResponse(page);
}

function handleCategories(context: RequestContext): Response {
  requireActor(context);
  return jsonResponse({ categories: listCategories() });
}

function handleGetOne(context: RequestContext): Response {
  const actor = requireActor(context);
  const reviewId = requireId(context.params.id, "Review id");
  return jsonResponse({
    review: getReview(reviewId, actor),
    comments: listComments(reviewId, actor),
  });
}

async function handleCreate(context: RequestContext): Promise<Response> {
  const actor = requireActor(context);
  assertCsrfToken(context);
  const review = createReview(actor, readReviewInput(await readJsonBody(context.request)));
  return jsonResponse({ review }, 201);
}

async function handleUpdate(context: RequestContext): Promise<Response> {
  const actor = requireActor(context);
  assertCsrfToken(context);
  const review = updateReview(
    actor,
    requireId(context.params.id, "Review id"),
    readReviewInput(await readJsonBody(context.request)),
  );
  return jsonResponse({ review });
}

function handleDelete(context: RequestContext): Response {
  const actor = requireActor(context);
  assertCsrfToken(context);
  deleteReview(actor, requireId(context.params.id, "Review id"));
  return jsonResponse({ deleted: true });
}

function handleVote(context: RequestContext): Response {
  const actor = requireActor(context);
  assertCsrfToken(context);
  return jsonResponse(toggleHelpfulVote(actor, requireId(context.params.id, "Review id")));
}

async function handleFlag(context: RequestContext): Promise<Response> {
  const actor = requireActor(context);
  assertCsrfToken(context);
  const body = await readJsonBody(context.request);
  flagReview(
    actor,
    requireId(context.params.id, "Review id"),
    requireString(body.reason, "Reason", { min: 4, max: 300 }),
  );
  return jsonResponse({ reported: true }, 201);
}

async function handleAddComment(context: RequestContext): Promise<Response> {
  const actor = requireActor(context);
  assertCsrfToken(context);
  const body = await readJsonBody(context.request);
  const comment = addComment(
    actor,
    requireId(context.params.id, "Review id"),
    requireString(body.body, "Reply", { min: 2, max: 1000 }),
    requireBoolean(body.isAnonymous),
  );
  return jsonResponse({ comment }, 201);
}

function handleDeleteComment(context: RequestContext): Response {
  const actor = requireActor(context);
  assertCsrfToken(context);
  deleteComment(actor, requireId(context.params.id, "Comment id"));
  return jsonResponse({ deleted: true });
}

export const reviewRoutes: Route[] = [
  { method: "GET", pattern: "/api/categories", handler: handleCategories },
  { method: "GET", pattern: "/api/reviews", handler: handleList },
  { method: "POST", pattern: "/api/reviews", handler: handleCreate },
  { method: "GET", pattern: "/api/reviews/:id", handler: handleGetOne },
  { method: "PATCH", pattern: "/api/reviews/:id", handler: handleUpdate },
  { method: "DELETE", pattern: "/api/reviews/:id", handler: handleDelete },
  { method: "POST", pattern: "/api/reviews/:id/helpful", handler: handleVote },
  { method: "POST", pattern: "/api/reviews/:id/report", handler: handleFlag },
  { method: "POST", pattern: "/api/reviews/:id/comments", handler: handleAddComment },
  { method: "DELETE", pattern: "/api/comments/:id", handler: handleDeleteComment },
];
