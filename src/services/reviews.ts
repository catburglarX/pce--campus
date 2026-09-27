/**
 * Campus reviews: create, list, edit and delete.
 *
 * A listing query filters by owner in SQL rather than fetching everything and hiding rows afterwards,
 * which is the difference auth-implement draws between a filter and an access control. Votes, flags,
 * comments and moderation live in review-interactions.ts.
 */

import { getDb } from "../db/connection";
import { forbidden, notFound } from "../errors";
import { isoTimestamp } from "../domain/calendar";
import { canDeleteContent, canEditOwnContent, type Actor } from "../domain/access-rules";
import { requireCategoryId } from "./categories";

export type ReviewSort = "recent" | "helpful" | "highest" | "lowest";

export type Review = {
  id: number;
  categoryId: number;
  categorySlug: string;
  categoryName: string;
  subject: string;
  title: string;
  body: string;
  stars: number;
  isAnonymous: boolean;
  status: "visible" | "hidden";
  hiddenReason: string;
  authorName: string;
  isMine: boolean;
  helpfulCount: number;
  iFoundHelpful: boolean;
  commentCount: number;
  flagCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ReviewRow = {
  id: number;
  user_id: number;
  category_id: number;
  subject: string;
  title: string;
  body: string;
  stars: number;
  is_anonymous: number;
  status: "visible" | "hidden";
  hidden_reason: string;
  created_at: string;
  updated_at: string;
  author_name: string;
  category_slug: string;
  category_name: string;
  helpful_count: number;
  i_found_helpful: number;
  comment_count: number;
  flag_count: number;
};

export type ReviewQuery = {
  viewer: Actor;
  categorySlug?: string;
  search?: string;
  sort: ReviewSort;
  mineOnly: boolean;
  page: number;
  pageSize: number;
};

export type ReviewInput = {
  categoryId: number;
  subject: string;
  title: string;
  body: string;
  stars: number;
  isAnonymous: boolean;
};

const ORDER_CLAUSES: Record<ReviewSort, string> = {
  recent: "reviews.created_at DESC",
  helpful: "helpful_count DESC, reviews.created_at DESC",
  highest: "reviews.stars DESC, helpful_count DESC",
  lowest: "reviews.stars ASC, helpful_count DESC",
};

const SELECT_COLUMNS = `
  reviews.*, users.name AS author_name,
  categories.slug AS category_slug, categories.name AS category_name,
  (SELECT COUNT(*) FROM review_votes WHERE review_votes.review_id = reviews.id) AS helpful_count,
  (SELECT COUNT(*) FROM review_votes WHERE review_votes.review_id = reviews.id AND review_votes.user_id = $viewerId) AS i_found_helpful,
  (SELECT COUNT(*) FROM review_comments WHERE review_comments.review_id = reviews.id) AS comment_count,
  (SELECT COUNT(*) FROM review_flags WHERE review_flags.review_id = reviews.id) AS flag_count`;

export function toReview(row: ReviewRow, viewer: Actor): Review {
  const anonymous = row.is_anonymous === 1;
  const isMine = row.user_id === viewer.id;
  return {
    id: row.id,
    categoryId: row.category_id,
    categorySlug: row.category_slug,
    categoryName: row.category_name,
    subject: row.subject,
    title: row.title,
    body: row.body,
    stars: row.stars,
    isAnonymous: anonymous,
    status: row.status,
    hiddenReason: row.hidden_reason,
    authorName: anonymous && !isMine ? "Anonymous student" : row.author_name,
    isMine,
    helpfulCount: row.helpful_count,
    iFoundHelpful: row.i_found_helpful > 0,
    commentCount: row.comment_count,
    flagCount: viewer.role === "admin" ? row.flag_count : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Visibility rule in one place: everyone sees visible reviews, authors still see their own after a
 * moderator hides one so they know it happened, and admins see everything.
 */
function visibilityClause(viewer: Actor): string {
  if (viewer.role === "admin") return "1 = 1";
  return "(reviews.status = 'visible' OR reviews.user_id = $viewerId)";
}

function buildFilters(query: ReviewQuery): { sql: string; bindings: Record<string, string | number> } {
  const clauses = [visibilityClause(query.viewer)];
  const bindings: Record<string, string | number> = { $viewerId: query.viewer.id };
  if (query.categorySlug) {
    clauses.push("categories.slug = $categorySlug");
    bindings.$categorySlug = query.categorySlug;
  }
  if (query.mineOnly) {
    clauses.push("reviews.user_id = $viewerId");
  }
  if (query.search) {
    clauses.push("(reviews.title LIKE $search OR reviews.body LIKE $search OR reviews.subject LIKE $search)");
    bindings.$search = `%${query.search.replace(/[%_]/g, "")}%`;
  }
  return { sql: clauses.join(" AND "), bindings };
}

export type ReviewPage = { items: Review[]; total: number; page: number; pageSize: number };

export function listReviews(query: ReviewQuery): ReviewPage {
  const { sql: whereSql, bindings } = buildFilters(query);
  const db = getDb();
  const total =
    db
      .query<{ total: number }, typeof bindings>(
        `SELECT COUNT(*) AS total FROM reviews
           JOIN users ON users.id = reviews.user_id
           JOIN categories ON categories.id = reviews.category_id
          WHERE ${whereSql}`,
      )
      .get(bindings)?.total ?? 0;
  const rows = db
    .query<ReviewRow, typeof bindings>(
      `SELECT ${SELECT_COLUMNS}
         FROM reviews
         JOIN users ON users.id = reviews.user_id
         JOIN categories ON categories.id = reviews.category_id
        WHERE ${whereSql}
        ORDER BY ${ORDER_CLAUSES[query.sort]}
        LIMIT $limit OFFSET $offset`,
    )
    .all({
      ...bindings,
      $limit: query.pageSize,
      $offset: (query.page - 1) * query.pageSize,
    });
  return {
    items: rows.map((row) => toReview(row, query.viewer)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** Reads one review with the same visibility rule as the listing. Throws 404 rather than 403 when hidden. */
export function getReview(reviewId: number, viewer: Actor): Review {
  const row = getDb()
    .query<ReviewRow, { $viewerId: number; $reviewId: number }>(
      `SELECT ${SELECT_COLUMNS}
         FROM reviews
         JOIN users ON users.id = reviews.user_id
         JOIN categories ON categories.id = reviews.category_id
        WHERE reviews.id = $reviewId AND ${visibilityClause(viewer)}`,
    )
    .get({ $viewerId: viewer.id, $reviewId: reviewId });
  if (!row) throw notFound("Review");
  return toReview(row, viewer);
}

function readOwnerRow(reviewId: number): { id: number; user_id: number } {
  const row = getDb()
    .query<{ id: number; user_id: number }, [number]>("SELECT id, user_id FROM reviews WHERE id = ?")
    .get(reviewId);
  if (!row) throw notFound("Review");
  return row;
}

export function createReview(actor: Actor, input: ReviewInput): Review {
  requireCategoryId(input.categoryId);
  const now = isoTimestamp();
  const created = getDb()
    .query<{ id: number }, [number, number, string, string, string, number, number, string, string]>(
      `INSERT INTO reviews (user_id, category_id, subject, title, body, stars, is_anonymous, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      actor.id,
      input.categoryId,
      input.subject,
      input.title,
      input.body,
      input.stars,
      input.isAnonymous ? 1 : 0,
      now,
      now,
    );
  if (!created) throw new Error(`Review insert for user ${actor.id} returned no row`);
  return getReview(created.id, actor);
}

/** Only the author may edit. An admin can hide a review but cannot rewrite what a student said. */
export function updateReview(actor: Actor, reviewId: number, input: ReviewInput): Review {
  const owner = readOwnerRow(reviewId);
  if (!canEditOwnContent(actor, owner)) throw forbidden("You can only edit your own review.");
  requireCategoryId(input.categoryId);
  getDb().run(
    `UPDATE reviews SET category_id = ?, subject = ?, title = ?, body = ?, stars = ?, is_anonymous = ?,
            updated_at = ? WHERE id = ?`,
    [
      input.categoryId,
      input.subject,
      input.title,
      input.body,
      input.stars,
      input.isAnonymous ? 1 : 0,
      isoTimestamp(),
      reviewId,
    ],
  );
  return getReview(reviewId, actor);
}

export function deleteReview(actor: Actor, reviewId: number): void {
  const owner = readOwnerRow(reviewId);
  if (!canDeleteContent(actor, owner)) throw forbidden("You can only delete your own review.");
  getDb().run("DELETE FROM reviews WHERE id = ?", [reviewId]);
}

export function countReviewsByUser(userId: number): number {
  const row = getDb()
    .query<{ total: number }, [number]>("SELECT COUNT(*) AS total FROM reviews WHERE user_id = ?")
    .get(userId);
  return row?.total ?? 0;
}
