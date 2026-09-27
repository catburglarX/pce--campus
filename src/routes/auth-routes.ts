/**
 * Authentication endpoints: register, login, logout, who am I, change password, edit profile.
 *
 * Login is rate limited by email and by source address. Failures are counted before the password hash
 * runs, so a flood costs the attacker time without costing the server 19 MiB of hashing per attempt.
 */

import { config } from "../config";
import { AppError } from "../errors";
import {
  buildExpiredSessionCookie,
  buildSessionCookie,
  jsonResponse,
  readJsonBody,
  SESSION_COOKIE,
  parseCookies,
} from "../http";
import { assertWithinLimit, clearFailures, recordFailure } from "../ratelimit";
import type { Route, RequestContext } from "../router";
import { assertCsrfToken, requireUser } from "../middleware/guard";
import { createSession, destroySession, countActiveSessions } from "../services/sessions";
import {
  changePassword,
  registerStudent,
  toPublicUser,
  updateProfile,
  verifyCredentials,
} from "../services/users";
import { getMyActivity } from "../services/stats";
import {
  optionalInteger,
  optionalString,
  requireBoolean,
  requireEmail,
  requireString,
} from "../validate";

const LOGIN_POLICY = {
  maxAttempts: config.loginMaxAttempts,
  windowMinutes: config.loginWindowMinutes,
};

function sessionResponse(
  userId: number,
  userAgent: string,
  payload: Record<string, unknown>,
  status = 200,
): Response {
  const session = createSession(userId, userAgent);
  return jsonResponse({ ...payload, csrfToken: session.csrfToken }, status, {
    "Set-Cookie": buildSessionCookie(session.token, session.expiresAt),
  });
}

async function handleRegister(context: RequestContext): Promise<Response> {
  const body = await readJsonBody(context.request);
  const addressKey = `register:${context.clientAddress}`;
  assertWithinLimit(addressKey, { maxAttempts: 10, windowMinutes: 60 });
  try {
    const user = await registerStudent({
      name: requireString(body.name, "Name", { min: 2, max: 80 }),
      email: requireEmail(body.email),
      password: requireString(body.password, "Password", { min: 1, max: 200 }),
      joinCode: requireString(body.joinCode, "Join code", { min: 1, max: 60 }),
      branch: optionalString(body.branch, "Branch", 60),
      studyYear: optionalInteger(body.studyYear, "Year of study", { min: 1, max: 5 }),
      isHostelResident: requireBoolean(body.isHostelResident),
    });
    return sessionResponse(user.id, context.request.headers.get("user-agent") ?? "", { user }, 201);
  } catch (error) {
    recordFailure(addressKey, { maxAttempts: 10, windowMinutes: 60 });
    throw error;
  }
}

async function handleLogin(context: RequestContext): Promise<Response> {
  const body = await readJsonBody(context.request);
  const email = requireEmail(body.email);
  const password = requireString(body.password, "Password", { min: 1, max: 200 });
  const emailKey = `login:email:${email}`;
  const addressKey = `login:address:${context.clientAddress}`;
  assertWithinLimit(emailKey, LOGIN_POLICY);
  assertWithinLimit(addressKey, { maxAttempts: LOGIN_POLICY.maxAttempts * 3, windowMinutes: LOGIN_POLICY.windowMinutes });
  try {
    const user = await verifyCredentials(email, password);
    clearFailures(emailKey);
    clearFailures(addressKey);
    return sessionResponse(user.id, context.request.headers.get("user-agent") ?? "", {
      user: toPublicUser(user),
    });
  } catch (error) {
    if (error instanceof AppError && (error.code === "unauthenticated" || error.code === "forbidden")) {
      recordFailure(emailKey, LOGIN_POLICY);
      recordFailure(addressKey, LOGIN_POLICY);
    }
    throw error;
  }
}

function handleLogout(context: RequestContext): Response {
  const token = parseCookies(context.request.headers.get("cookie"))[SESSION_COOKIE];
  if (context.session) assertCsrfToken(context);
  if (token) destroySession(token);
  return jsonResponse({ signedOut: true }, 200, { "Set-Cookie": buildExpiredSessionCookie() });
}

function handleMe(context: RequestContext): Response {
  const user = requireUser(context);
  return jsonResponse({
    user: toPublicUser(user),
    csrfToken: context.session?.csrfToken ?? "",
    activity: getMyActivity(user.id),
    activeSessions: countActiveSessions(user.id),
    joinCodeHint: user.role === "admin" ? config.joinCode : null,
  });
}

/** A password change drops every session, so the caller is handed a fresh one to stay signed in. */
async function handlePasswordChange(context: RequestContext): Promise<Response> {
  const user = requireUser(context);
  assertCsrfToken(context);
  const body = await readJsonBody(context.request);
  await changePassword(
    user.id,
    requireString(body.currentPassword, "Current password", { min: 1, max: 200 }),
    requireString(body.newPassword, "New password", { min: 1, max: 200 }),
  );
  return sessionResponse(user.id, context.request.headers.get("user-agent") ?? "", {
    passwordChanged: true,
    otherSessionsSignedOut: true,
  });
}

async function handleProfileUpdate(context: RequestContext): Promise<Response> {
  const user = requireUser(context);
  assertCsrfToken(context);
  const body = await readJsonBody(context.request);
  const updated = updateProfile(user.id, {
    name: requireString(body.name, "Name", { min: 2, max: 80 }),
    branch: optionalString(body.branch, "Branch", 60),
    studyYear: optionalInteger(body.studyYear, "Year of study", { min: 1, max: 5 }),
    isHostelResident: requireBoolean(body.isHostelResident),
  });
  return jsonResponse({ user: updated });
}

export const authRoutes: Route[] = [
  { method: "POST", pattern: "/api/auth/register", handler: handleRegister },
  { method: "POST", pattern: "/api/auth/login", handler: handleLogin },
  { method: "POST", pattern: "/api/auth/logout", handler: handleLogout },
  { method: "GET", pattern: "/api/auth/me", handler: handleMe },
  { method: "POST", pattern: "/api/auth/password", handler: handlePasswordChange },
  { method: "PATCH", pattern: "/api/auth/profile", handler: handleProfileUpdate },
];
