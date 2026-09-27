/**
 * Request guards.
 *
 * Every protected handler starts with one of these. They are the only place that turns "there is a
 * session" into "this actor may act", and requireAdmin is the only path to a moderation action.
 */

import { forbidden, unauthenticated } from "../errors";
import { CSRF_HEADER } from "../http";
import type { RequestContext } from "../router";
import type { Actor } from "../domain/access-rules";
import type { UserRow } from "../services/users";

export function requireUser(context: RequestContext): UserRow {
  if (!context.session) throw unauthenticated();
  return context.session.user;
}

export function requireActor(context: RequestContext): Actor {
  const user = requireUser(context);
  return { id: user.id, role: user.role };
}

export function requireAdmin(context: RequestContext): Actor {
  const actor = requireActor(context);
  if (actor.role !== "admin") throw forbidden("Only a campus admin can do that.");
  return actor;
}

/**
 * Verify the CSRF token on any state-changing request.
 *
 * SameSite=Strict already blocks a cross-site form post, but a token tied to the session is the control
 * that does not depend on browser behaviour, and the two together cost nothing.
 */
export function assertCsrfToken(context: RequestContext): void {
  if (!context.session) throw unauthenticated();
  const supplied = context.request.headers.get(CSRF_HEADER) ?? "";
  if (supplied.length === 0) {
    throw forbidden("Missing CSRF token. Reload the page and try again.");
  }
  if (supplied !== context.session.csrfToken) {
    throw forbidden("That form token is stale. Reload the page and try again.");
  }
}
