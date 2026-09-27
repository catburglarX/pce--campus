/**
 * Admin-only endpoints: the report queue, hiding and restoring a review, the student roster, role
 * changes and the audit trail. Every handler starts with requireAdmin, which is the only door.
 */

import { jsonResponse, readJsonBody } from "../http";
import type { RequestContext, Route } from "../router";
import { assertCsrfToken, requireAdmin } from "../middleware/guard";
import { clearFlags, listFlaggedReviews, setReviewStatus } from "../services/review-interactions";
import { listAuditEntries } from "../services/audit";
import { listUsers, setUserActive, setUserRole, type UserRole } from "../services/users";
import { requireBoolean, requireEnum, requireId } from "../validate";

function handleReports(context: RequestContext): Response {
  const actor = requireAdmin(context);
  return jsonResponse({ reports: listFlaggedReviews(actor) });
}

/**
 * The blank-reason rule belongs to setReviewStatus, so the reason is only length-clamped here. Validating
 * it at the edge as well would answer with "Reason must be at least 1 character" instead of telling the
 * admin that the author is going to read it.
 */
async function handleHide(context: RequestContext): Promise<Response> {
  const actor = requireAdmin(context);
  assertCsrfToken(context);
  const body = await readJsonBody(context.request);
  const suppliedReason = typeof body.reason === "string" ? body.reason.slice(0, 300) : "";
  const review = setReviewStatus(actor, requireId(context.params.id, "Review id"), "hidden", suppliedReason);
  return jsonResponse({ review });
}

function handleRestore(context: RequestContext): Response {
  const actor = requireAdmin(context);
  assertCsrfToken(context);
  const review = setReviewStatus(actor, requireId(context.params.id, "Review id"), "visible", "");
  return jsonResponse({ review });
}

function handleClearReports(context: RequestContext): Response {
  const actor = requireAdmin(context);
  assertCsrfToken(context);
  clearFlags(actor, requireId(context.params.id, "Review id"));
  return jsonResponse({ cleared: true });
}

function handleRoster(context: RequestContext): Response {
  requireAdmin(context);
  return jsonResponse({ students: listUsers(), audit: listAuditEntries(60) });
}

async function handleRoleChange(context: RequestContext): Promise<Response> {
  const actor = requireAdmin(context);
  assertCsrfToken(context);
  const body = await readJsonBody(context.request);
  const user = setUserRole(
    actor,
    requireId(context.params.id, "Student id"),
    requireEnum<UserRole>(body.role, "Role", ["student", "admin"]),
  );
  return jsonResponse({ user });
}

async function handleActiveChange(context: RequestContext): Promise<Response> {
  const actor = requireAdmin(context);
  assertCsrfToken(context);
  const body = await readJsonBody(context.request);
  const user = setUserActive(actor, requireId(context.params.id, "Student id"), requireBoolean(body.isActive));
  return jsonResponse({ user });
}

export const adminRoutes: Route[] = [
  { method: "GET", pattern: "/api/admin/reports", handler: handleReports },
  { method: "POST", pattern: "/api/admin/reviews/:id/hide", handler: handleHide },
  { method: "POST", pattern: "/api/admin/reviews/:id/restore", handler: handleRestore },
  { method: "POST", pattern: "/api/admin/reviews/:id/clear-reports", handler: handleClearReports },
  { method: "GET", pattern: "/api/admin/roster", handler: handleRoster },
  { method: "PATCH", pattern: "/api/admin/users/:id/role", handler: handleRoleChange },
  { method: "PATCH", pattern: "/api/admin/users/:id/active", handler: handleActiveChange },
];
