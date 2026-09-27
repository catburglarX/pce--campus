/**
 * Complaints: the channel for something broken rather than something rated.
 *
 * A complaint has a status an admin moves through, and a "same problem here" vote so the mess committee
 * can tell one annoyed student from forty.
 */

import { getDb } from "../db/connection";
import { forbidden, notFound, validationError } from "../errors";
import { isoTimestamp } from "../domain/calendar";
import { canWithdrawComplaint, canModerate, type Actor } from "../domain/access-rules";
import { requireCategoryId } from "./categories";
import { recordAuditEntry } from "./audit";

export const COMPLAINT_STATUSES = ["open", "in_progress", "resolved", "rejected"] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const COMPLAINT_SEVERITIES = ["low", "normal", "high"] as const;
export type ComplaintSeverity = (typeof COMPLAINT_SEVERITIES)[number];

export type Complaint = {
  id: number;
  categoryId: number;
  categorySlug: string;
  categoryName: string;
  title: string;
  body: string;
  location: string;
  severity: ComplaintSeverity;
  status: ComplaintStatus;
  resolutionNote: string;
  resolvedByName: string | null;
  isAnonymous: boolean;
  authorName: string;
  isMine: boolean;
  supportCount: number;
  iSupport: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ComplaintInput = {
  categoryId: number;
  title: string;
  body: string;
  location: string;
  severity: ComplaintSeverity;
  isAnonymous: boolean;
};

type ComplaintRow = {
  id: number;
  user_id: number;
  category_id: number;
  title: string;
  body: string;
  location: string;
  severity: ComplaintSeverity;
  status: ComplaintStatus;
  resolution_note: string;
  is_anonymous: number;
  created_at: string;
  updated_at: string;
  author_name: string;
  resolver_name: string | null;
  category_slug: string;
  category_name: string;
  support_count: number;
  i_support: number;
};

const SELECT_COLUMNS = `
  complaints.*, author.name AS author_name, resolver.name AS resolver_name,
  categories.slug AS category_slug, categories.name AS category_name,
  (SELECT COUNT(*) FROM complaint_votes WHERE complaint_votes.complaint_id = complaints.id) AS support_count,
  (SELECT COUNT(*) FROM complaint_votes WHERE complaint_votes.complaint_id = complaints.id AND complaint_votes.user_id = $viewerId) AS i_support
  FROM complaints
  JOIN users AS author ON author.id = complaints.user_id
  LEFT JOIN users AS resolver ON resolver.id = complaints.resolved_by
  JOIN categories ON categories.id = complaints.category_id`;

function toComplaint(row: ComplaintRow, viewer: Actor): Complaint {
  const anonymous = row.is_anonymous === 1;
  const isMine = row.user_id === viewer.id;
  return {
    id: row.id,
    categoryId: row.category_id,
    categorySlug: row.category_slug,
    categoryName: row.category_name,
    title: row.title,
    body: row.body,
    location: row.location,
    severity: row.severity,
    status: row.status,
    resolutionNote: row.resolution_note,
    resolvedByName: row.resolver_name,
    isAnonymous: anonymous,
    authorName: anonymous && !isMine ? "Anonymous student" : row.author_name,
    isMine,
    supportCount: row.support_count,
    iSupport: row.i_support > 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type ComplaintQuery = {
  viewer: Actor;
  status?: ComplaintStatus;
  categorySlug?: string;
  mineOnly: boolean;
};

export function listComplaints(query: ComplaintQuery): Complaint[] {
  const clauses: string[] = [];
  const bindings: Record<string, string | number> = { $viewerId: query.viewer.id };
  if (query.status) {
    clauses.push("complaints.status = $status");
    bindings.$status = query.status;
  }
  if (query.categorySlug) {
    clauses.push("categories.slug = $categorySlug");
    bindings.$categorySlug = query.categorySlug;
  }
  if (query.mineOnly) clauses.push("complaints.user_id = $viewerId");
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return getDb()
    .query<ComplaintRow, typeof bindings>(
      `SELECT ${SELECT_COLUMNS} ${whereSql}
        ORDER BY CASE complaints.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
                 support_count DESC, complaints.created_at DESC`,
    )
    .all(bindings)
    .map((row) => toComplaint(row, query.viewer));
}

export function getComplaint(complaintId: number, viewer: Actor): Complaint {
  const row = getDb()
    .query<ComplaintRow, { $viewerId: number; $complaintId: number }>(
      `SELECT ${SELECT_COLUMNS} WHERE complaints.id = $complaintId`,
    )
    .get({ $viewerId: viewer.id, $complaintId: complaintId });
  if (!row) throw notFound("Complaint");
  return toComplaint(row, viewer);
}

export function createComplaint(actor: Actor, input: ComplaintInput): Complaint {
  requireCategoryId(input.categoryId);
  const now = isoTimestamp();
  const created = getDb()
    .query<{ id: number }, [number, number, string, string, string, string, number, string, string]>(
      `INSERT INTO complaints (user_id, category_id, title, body, location, severity, is_anonymous, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      actor.id,
      input.categoryId,
      input.title,
      input.body,
      input.location,
      input.severity,
      input.isAnonymous ? 1 : 0,
      now,
      now,
    );
  if (!created) throw new Error(`Complaint insert for user ${actor.id} returned no row`);
  return getComplaint(created.id, actor);
}

/** "Same problem here" toggles, one per student per complaint, enforced by the primary key. */
export function toggleComplaintSupport(actor: Actor, complaintId: number): Complaint {
  const complaint = getComplaint(complaintId, actor);
  if (complaint.isMine) throw forbidden("You raised this one, so it already counts as yours.");
  const existing = getDb()
    .query<{ total: number }, [number, number]>(
      "SELECT COUNT(*) AS total FROM complaint_votes WHERE complaint_id = ? AND user_id = ?",
    )
    .get(complaintId, actor.id);
  if ((existing?.total ?? 0) > 0) {
    getDb().run("DELETE FROM complaint_votes WHERE complaint_id = ? AND user_id = ?", [complaintId, actor.id]);
  } else {
    getDb().run("INSERT INTO complaint_votes (complaint_id, user_id, created_at) VALUES (?, ?, ?)", [
      complaintId,
      actor.id,
      isoTimestamp(),
    ]);
  }
  return getComplaint(complaintId, actor);
}

export function updateComplaintStatus(
  actor: Actor,
  complaintId: number,
  status: ComplaintStatus,
  resolutionNote: string,
): Complaint {
  if (!canModerate(actor)) throw forbidden("Only a campus admin can change a complaint's status.");
  if ((status === "resolved" || status === "rejected") && resolutionNote.trim().length === 0) {
    throw validationError("Add a note saying what was done. The student will read it.", "resolutionNote");
  }
  const closing = status === "resolved" || status === "rejected";
  const changes = getDb().run(
    "UPDATE complaints SET status = ?, resolution_note = ?, resolved_by = ?, updated_at = ? WHERE id = ?",
    [status, resolutionNote, closing ? actor.id : null, isoTimestamp(), complaintId],
  ).changes;
  if (changes === 0) throw notFound("Complaint");
  recordAuditEntry(actor.id, `complaint.${status}`, "complaint", complaintId, resolutionNote);
  return getComplaint(complaintId, actor);
}

export function withdrawComplaint(actor: Actor, complaintId: number): void {
  const row = getDb()
    .query<{ id: number; user_id: number; status: ComplaintStatus }, [number]>(
      "SELECT id, user_id, status FROM complaints WHERE id = ?",
    )
    .get(complaintId);
  if (!row) throw notFound("Complaint");
  if (!canWithdrawComplaint(actor, row)) {
    throw forbidden("You can only withdraw your own complaint while it is still open.");
  }
  getDb().run("DELETE FROM complaints WHERE id = ?", [complaintId]);
  if (row.user_id !== actor.id) recordAuditEntry(actor.id, "complaint.deleted", "complaint", complaintId);
}
