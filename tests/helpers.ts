/**
 * Test helpers.
 *
 * Tests drive the real request pipeline through handleRequest rather than a mock, so routing, session
 * resolution, CSRF and the database all take part. Each suite gets its own SQLite file under the OS
 * temporary directory and deletes it afterwards.
 */

import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, useDatabase } from "../src/db/connection";
import { ensureAdminAccount, seedCategories, seedWeeklyMenu } from "../src/db/seed";
import { resetAllLimits } from "../src/ratelimit";
import { handleRequest } from "../src/server";
import { SESSION_COOKIE } from "../src/http";

export const JOIN_CODE = "PCE-CAMPUS-2026";
export const STRONG_PASSWORD = "mess-roti-is-cold-42";

export type TestSession = { cookie: string; csrfToken: string; user: Record<string, unknown> };

let databasePath = "";

export async function startTestDatabase(): Promise<void> {
  databasePath = join(tmpdir(), `campus-voice-test-${randomBytes(6).toString("hex")}.sqlite`);
  useDatabase(databasePath);
  seedCategories();
  seedWeeklyMenu();
  process.env.ADMIN_PASSWORD = STRONG_PASSWORD;
  await ensureAdminAccount();
  resetAllLimits();
}

/**
 * Deletes the suite's database files.
 *
 * Windows keeps a handle on the file for a moment after close, so a delete straight after closing fails
 * with EBUSY. Retrying briefly clears it; if it still will not go, the file is left in the OS temporary
 * directory rather than failing the suite over cleanup.
 */
export async function stopTestDatabase(): Promise<void> {
  closeDatabase();
  const files = ["", "-shm", "-wal"].map((suffix) => `${databasePath}${suffix}`);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const remaining = files.filter((file) => existsSync(file));
    if (remaining.length === 0) return;
    for (const file of remaining) {
      try {
        rmSync(file, { force: true });
      } catch {
        // Held by the OS for another moment; the next attempt will pick it up.
      }
    }
    await Bun.sleep(40);
  }
}

export type CallOptions = {
  body?: unknown;
  cookie?: string;
  csrfToken?: string;
  headers?: Record<string, string>;
};

export async function call(method: string, path: string, options: CallOptions = {}): Promise<Response> {
  const headers = new Headers(options.headers ?? {});
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.csrfToken) headers.set("x-csrf-token", options.csrfToken);
  const request = new Request(`http://localhost${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return handleRequest(request, null);
}

export async function callJson<T = Record<string, never>>(
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<{ status: number; body: T }> {
  const response = await call(method, path, options);
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as T) : ({} as T) };
}

export function readSessionCookie(response: Response): string {
  const raw = response.headers.get("set-cookie") ?? "";
  const value = raw.split(";")[0] ?? "";
  if (!value.startsWith(`${SESSION_COOKIE}=`)) {
    throw new Error(`Expected a ${SESSION_COOKIE} cookie, got "${raw}"`);
  }
  return value;
}

export async function registerStudentSession(
  email: string,
  name = "Test Student",
): Promise<TestSession> {
  const response = await call("POST", "/api/auth/register", {
    body: {
      name,
      email,
      password: STRONG_PASSWORD,
      joinCode: JOIN_CODE,
      branch: "Computer Science",
      studyYear: 3,
      isHostelResident: true,
    },
  });
  if (response.status !== 201) {
    throw new Error(`Register failed for ${email}: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as { csrfToken: string; user: Record<string, unknown> };
  return { cookie: readSessionCookie(response), csrfToken: payload.csrfToken, user: payload.user };
}

export async function loginSession(email: string, password = STRONG_PASSWORD): Promise<TestSession> {
  const response = await call("POST", "/api/auth/login", { body: { email, password } });
  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as { csrfToken: string; user: Record<string, unknown> };
  return { cookie: readSessionCookie(response), csrfToken: payload.csrfToken, user: payload.user };
}

export async function adminSession(): Promise<TestSession> {
  return loginSession("admin@poornima.org", STRONG_PASSWORD);
}

export async function firstCategoryId(session: TestSession, slug = "hostel"): Promise<number> {
  const { body } = await callJson<{ categories: { id: number; slug: string }[] }>(
    "GET",
    "/api/categories",
    { cookie: session.cookie },
  );
  const category = body.categories.find((entry) => entry.slug === slug);
  if (!category) throw new Error(`Category ${slug} was not seeded`);
  return category.id;
}
