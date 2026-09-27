/**
 * What students do to a review after it is posted: mark it helpful, flag it, comment on it, and what an
 * admin does about a flag. Kept apart from reviews.ts because these change for different reasons.
 */

import { getDb } from "../db/connection";
import { conflict, forbidden, notFound, validationError } from "../errors";
import { isoTimestamp } from "../domain/calendar";
import { canDeleteContent, canModerate, type Actor } from "../domain/access-rules";
import { getReview, type Review } from "./reviews";
import { recordAuditEntry } from "./audit";

export type VoteOutcome = { reviewId: number; helpfulCount: number; iFoundHelpful: boolean };

export type ReviewComment = {
  id: number;
  reviewId: number;
  body: string;
  authorName: string;
  isAnonymous: boolean;
  isMine: boolean;
  createdAt: string;
};

export type FlaggedReview = Review & { flagReasons: string[] };

type CommentRow = {
  id: number;
  review_id: number;
  user_id: number;
  body: string;
  is_anonymous: number;
  created_at: string;
  author_name: string;
};

function countHelpful(reviewId: number): number {
  const row = getDb()
    .query<{ total: number }, [number]>("SELECT COUNT(*) AS total FROM review_votes WHERE review_id = ?")
    .get(reviewId);
  return row?.total ?? 0;
}

function hasVoted(reviewId: number, userId: number): boolean {
  const row = getDb()
    .query<{ total: number }, [number, number]>(
      "SELECT COUNT(*) AS total FROM review_votes WHERE review_id = ? AND user_id = ?",
    )
    .get(reviewId, userId);
  return (row?.total ?? 0) > 0;
}

/** Marking helpful toggles, so a second click takes the vote back rather than adding another. */
export function toggleHelpfulVote(actor: Actor, reviewId: number): VoteOutcome {
  const review = getReview(reviewId, actor);
  if (review.isMine) throw forbidden("You cannot mark your own review helpful.");
  if (review.status === "hidden") throw forbidden("That review is hidden.");
  if (hasVoted(reviewId, actor.id)) {
    getDb().run("DELETE FROM review_votes WHERE review_id = ? AND user_id = ?", [reviewId, actor.id]);
    return { reviewId, helpfulCount: countHelpful(reviewId), iFoundHelpful: false };
  }
  getDb().run("INSERT INTO review_votes (review_id, user_id, created_at) VALUES (?, ?, ?)", [
    reviewId,
    actor.id,
    isoTimestamp(),
  ]);
  return { reviewId, helpfulCount: countHelpful(reviewId), iFoundHelpful: true };
}

export function flagReview(actor: Actor, reviewId: number, reason: string): void {
  const review = getReview(reviewId, actor);
  if (review.isMine) throw forbidden("Delete your own review instead of reporting it.");
  const already = getDb()
    .query<{ total: number }, [number, number]>(
      "SELECT COUNT(*) AS total FROM review_flags WHERE review_id = ? AND user_id = ?",
    )
    .get(reviewId, actor.id);
  if ((already?.total ?? 0) > 0) throw conflict("You already reported this review.");
  getDb().run("INSERT INTO review_flags (review_id, user_id, reason, created_at) VALUES (?, ?, ?, ?)", [
    reviewId,
    actor.id,
    reason,
    isoTimestamp(),
  ]);
}

export function listFlaggedReviews(actor: Actor): FlaggedReview[] {
  if (!canModerate(actor)) throw forbidden("Only a campus admin can see reports.");
  const ids = getDb()
    .query<{ review_id: number }, []>(
      "SELECT review_id FROM review_flags GROUP BY review_id ORDER BY COUNT(*) DESC, MAX(created_at) DESC",
    )
    .all();
  return ids.map((row) => {
    const reasons = getDb()
      .query<{ reason: string }, [number]>(
        "SELECT reason FROM review_flags WHERE review_id = ? ORDER BY created_at DESC",
      )
      .all(row.review_id)
      .map((flag) => flag.reason);
    return { ...getReview(row.review_id, actor), flagReasons: reasons };
  });
}

export function setReviewStatus(
  actor: Actor,
  reviewId: number,
  status: "visible" | "hidden",
  reason: string,
): Review {
  if (!canModerate(actor)) throw forbidden("Only a campus admin can moderate reviews.");
  if (status === "hidden" && reason.trim().length === 0) {
    throw validationError("Say why it is being hidden. The author will see this.", "reason");
  }
  const changes = getDb().run("UPDATE reviews SET status = ?, hidden_reason = ? WHERE id = ?", [
    status,
    status === "hidden" ? reason : "",
    reviewId,
  ]).changes;
  if (changes === 0) throw notFound("Review");
  recordAuditEntry(actor.id, `review.${status}`, "review", reviewId, reason);
  return getReview(reviewId, actor);
}

export function clearFlags(actor: Actor, reviewId: number): void {
  if (!canModerate(actor)) throw forbidden("Only a campus admin can clear reports.");
  getDb().run("DELETE FROM review_flags WHERE review_id = ?", [reviewId]);
  recordAuditEntry(actor.id, "review.flags_cleared", "review", reviewId);
}

function toComment(row: CommentRow, viewer: Actor): ReviewComment {
  const anonymous = row.is_anonymous === 1;
  const isMine = row.user_id === viewer.id;
  return {
    id: row.id,
    reviewId: row.review_id,
    body: row.body,
    authorName: anonymous && !isMine ? "Anonymous student" : row.author_name,
    isAnonymous: anonymous,
    isMine,
    createdAt: row.created_at,
  };
}

export function listComments(reviewId: number, viewer: Actor): ReviewComment[] {
  getReview(reviewId, viewer);
  return getDb()
    .query<CommentRow, [number]>(
      `SELECT review_comments.*, users.name AS author_name
         FROM review_comments JOIN users ON users.id = review_comments.user_id
        WHERE review_comments.review_id = ? ORDER BY review_comments.created_at`,
    )
    .all(reviewId)
    .map((row) => toComment(row, viewer));
}

export function addComment(
  actor: Actor,
  reviewId: number,
  body: string,
  isAnonymous: boolean,
): ReviewComment {
  const review = getReview(reviewId, actor);
  if (review.status === "hidden") throw forbidden("That review is hidden, so it is closed for replies.");
  const created = getDb()
    .query<{ id: number }, [number, number, string, number, string]>(
      `INSERT INTO review_comments (review_id, user_id, body, is_anonymous, created_at)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(reviewId, actor.id, body, isAnonymous ? 1 : 0, isoTimestamp());
  if (!created) throw new Error(`Comment insert on review ${reviewId} returned no row`);
  const row = getDb()
    .query<CommentRow, [number]>(
      `SELECT review_comments.*, users.name AS author_name
         FROM review_comments JOIN users ON users.id = review_comments.user_id
        WHERE review_comments.id = ?`,
    )
    .get(created.id);
  if (!row) throw notFound("Comment");
  return toComment(row, actor);
}

export function deleteComment(actor: Actor, commentId: number): void {
  const row = getDb()
    .query<{ id: number; user_id: number }, [number]>("SELECT id, user_id FROM review_comments WHERE id = ?")
    .get(commentId);
  if (!row) throw notFound("Comment");
  if (!canDeleteContent(actor, row)) throw forbidden("You can only delete your own comment.");
  getDb().run("DELETE FROM review_comments WHERE id = ?", [commentId]);
  if (row.user_id !== actor.id) {
    recordAuditEntry(actor.id, "comment.deleted", "comment", commentId);
  }
}
