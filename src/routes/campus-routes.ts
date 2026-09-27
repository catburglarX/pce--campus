/**
 * Complaint and notice endpoints, plus the dashboard statistics read.
 */

import { jsonResponse, readJsonBody } from "../http";
import type { RequestContext, Route } from "../router";
import { assertCsrfToken, requireActor, requireAdmin } from "../middleware/guard";
import {
  COMPLAINT_SEVERITIES,
  COMPLAINT_STATUSES,
  createComplaint,
  getComplaint,
  listComplaints,
  toggleComplaintSupport,
  updateComplaintStatus,
  withdrawComplaint,
  type ComplaintSeverity,
  type ComplaintStatus,
} from "../services/complaints";
import { createNotice, deleteNotice, listNotices, updateNotice } from "../services/notices";
import { getOverview } from "../services/stats";
import {
  optionalString,
  requireBoolean,
  requireEnum,
  requireId,
  requireString,
} from "../validate";

function handleListComplaints(context: RequestContext): Response {
  const actor = requireActor(context);
  const parameters = context.url.searchParams;
  const status = parameters.get("status");
  return jsonResponse({
    complaints: listComplaints({
      viewer: actor,
      status: status ? requireEnum<ComplaintStatus>(status, "Status", COMPLAINT_STATUSES) : undefined,
      categorySlug: parameters.get("category") ?? undefined,
      mineOnly: parameters.get("mine") === "1",
    }),
    statuses: COMPLAINT_STATUSES,
    severities: COMPLAINT_SEVERITIES,
  });
}

async function handleCreateComplaint(context: RequestContext): Promise<Response> {
  const actor = requireActor(context);
  assertCsrfToken(context);
  const body = await readJsonBody(context.request);
  const complaint = createComplaint(actor, {
    categoryId: requireId(body.categoryId, "Category"),
    title: requireString(body.title, "Title", { min: 4, max: 120 }),
    body: requireString(body.body, "What is wrong", { min: 10, max: 3000 }),
    location: optionalString(body.location, "Location", 120),
    severity: requireEnum<ComplaintSeverity>(body.severity ?? "normal", "Severity", COMPLAINT_SEVERITIES),
    isAnonymous: requireBoolean(body.isAnonymous),
  });
  return jsonResponse({ complaint }, 201);
}

function handleGetComplaint(context: RequestContext): Response {
  const actor = requireActor(context);
  return jsonResponse({ complaint: getComplaint(requireId(context.params.id, "Complaint id"), actor) });
}

function handleSupport(context: RequestContext): Response {
  const actor = requireActor(context);
  assertCsrfToken(context);
  return jsonResponse({
    complaint: toggleComplaintSupport(actor, requireId(context.params.id, "Complaint id")),
  });
}

async function handleStatusChange(context: RequestContext): Promise<Response> {
  const actor = requireAdmin(context);
  assertCsrfToken(context);
  const body = await readJsonBody(context.request);
  const complaint = updateComplaintStatus(
    actor,
    requireId(context.params.id, "Complaint id"),
    requireEnum<ComplaintStatus>(body.status, "Status", COMPLAINT_STATUSES),
    optionalString(body.resolutionNote, "Note", 1000),
  );
  return jsonResponse({ complaint });
}

function handleWithdraw(context: RequestContext): Response {
  const actor = requireActor(context);
  assertCsrfToken(context);
  withdrawComplaint(actor, requireId(context.params.id, "Complaint id"));
  return jsonResponse({ deleted: true });
}

function handleListNotices(context: RequestContext): Response {
  requireActor(context);
  return jsonResponse({ notices: listNotices() });
}

async function handleCreateNotice(context: RequestContext): Promise<Response> {
  const actor = requireAdmin(context);
  assertCsrfToken(context);
  const body = await readJsonBody(context.request);
  const notice = createNotice(actor, {
    title: requireString(body.title, "Title", { min: 4, max: 140 }),
    body: requireString(body.body, "Notice", { min: 4, max: 3000 }),
    isPinned: requireBoolean(body.isPinned),
  });
  return jsonResponse({ notice }, 201);
}

async function handleUpdateNotice(context: RequestContext): Promise<Response> {
  const actor = requireAdmin(context);
  assertCsrfToken(context);
  const body = await readJsonBody(context.request);
  const notice = updateNotice(actor, requireId(context.params.id, "Notice id"), {
    title: requireString(body.title, "Title", { min: 4, max: 140 }),
    body: requireString(body.body, "Notice", { min: 4, max: 3000 }),
    isPinned: requireBoolean(body.isPinned),
  });
  return jsonResponse({ notice });
}

function handleDeleteNotice(context: RequestContext): Response {
  const actor = requireAdmin(context);
  assertCsrfToken(context);
  deleteNotice(actor, requireId(context.params.id, "Notice id"));
  return jsonResponse({ deleted: true });
}

function handleOverview(context: RequestContext): Response {
  requireActor(context);
  return jsonResponse(getOverview());
}

export const campusRoutes: Route[] = [
  { method: "GET", pattern: "/api/complaints", handler: handleListComplaints },
  { method: "POST", pattern: "/api/complaints", handler: handleCreateComplaint },
  { method: "GET", pattern: "/api/complaints/:id", handler: handleGetComplaint },
  { method: "POST", pattern: "/api/complaints/:id/support", handler: handleSupport },
  { method: "PATCH", pattern: "/api/complaints/:id/status", handler: handleStatusChange },
  { method: "DELETE", pattern: "/api/complaints/:id", handler: handleWithdraw },
  { method: "GET", pattern: "/api/notices", handler: handleListNotices },
  { method: "POST", pattern: "/api/notices", handler: handleCreateNotice },
  { method: "PATCH", pattern: "/api/notices/:id", handler: handleUpdateNotice },
  { method: "DELETE", pattern: "/api/notices/:id", handler: handleDeleteNotice },
  { method: "GET", pattern: "/api/stats/overview", handler: handleOverview },
];
