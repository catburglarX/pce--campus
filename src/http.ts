/**
 * HTTP plumbing: response builders, cookie handling, body reading and security headers.
 *
 * Route handlers return data or throw AppError. Turning either into bytes happens here, so no handler
 * writes a status code by hand.
 */

import { config } from "./config";
import { AppError } from "./errors";

export const SESSION_COOKIE = "campus_session";
export const CSRF_HEADER = "x-csrf-token";

/** A review body is the largest thing a student posts. 64 KiB is generous and stops memory abuse. */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Content-Security-Policy is strict because every script and stylesheet in this app is a separate file
 * served from the same origin. No inline script or style exists, so 'self' alone is enough and an
 * injected <script> tag cannot execute.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; " +
    "base-uri 'none'; object-src 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export function withSecurityHeaders(headers: Headers): Headers {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return headers;
}

export function jsonResponse(payload: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  for (const [name, value] of Object.entries(extraHeaders ?? {})) headers.set(name, value);
  return new Response(JSON.stringify(payload), { status, headers: withSecurityHeaders(headers) });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    const extra = error.retryAfterSeconds
      ? { "Retry-After": String(Math.ceil(error.retryAfterSeconds)) }
      : undefined;
    return jsonResponse(
      { error: { code: error.code, message: error.message, field: error.field ?? null } },
      error.status,
      extra,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error("[unhandled]", message);
  return jsonResponse(
    { error: { code: "internal", message: "Something broke on the server. Check the server log.", field: null } },
    500,
  );
}

export function redirectTo(location: string): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  return new Response(null, { status: 302, headers: withSecurityHeaders(headers) });
}

export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const jar: Record<string, string> = {};
  if (!cookieHeader) return jar;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    jar[name] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return jar;
}

export function buildSessionCookie(token: string, expiresAt: string): string {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (config.useSecureCookies) attributes.push("Secure");
  return attributes.join("; ");
}

export function buildExpiredSessionCookie(): string {
  const attributes = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (config.useSecureCookies) attributes.push("Secure");
  return attributes.join("; ");
}

/** Reads and parses a JSON body, refusing anything oversized or not declared as JSON. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new AppError("validation_failed", "Send this request as JSON.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    throw new AppError("validation_failed", "That is too much text. Keep it under 64 KB.");
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new AppError("validation_failed", "That is too much text. Keep it under 64 KB.");
  }
  if (raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AppError("validation_failed", "Expected a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("validation_failed", "That request body was not valid JSON.");
  }
}
