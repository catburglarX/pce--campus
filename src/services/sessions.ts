/**
 * Server-side sessions.
 *
 * The browser gets a random opaque token in an HttpOnly cookie. The database stores only its SHA-256,
 * so someone who copies campus-voice.sqlite cannot replay a login. Each session also carries a CSRF
 * token, which every state-changing request must echo in a header.
 */

import { createHash, randomBytes } from "node:crypto";

import { getDb } from "../db/connection";
import { config } from "../config";
import { isoTimestamp } from "../domain/calendar";
import type { UserRow } from "./users";

export type SessionRecord = {
  token: string;
  csrfToken: string;
  expiresAt: string;
};

export type ResolvedSession = {
  user: UserRow;
  csrfToken: string;
  expiresAt: string;
};

type SessionJoinRow = UserRow & { csrf_token: string; expires_at: string };

function randomToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(userId: number, userAgent: string): SessionRecord {
  const token = randomToken();
  const csrfToken = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionLifetimeHours * 3600 * 1000).toISOString();
  getDb().run(
    `INSERT INTO sessions (token_hash, user_id, csrf_token, user_agent, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [hashToken(token), userId, csrfToken, userAgent.slice(0, 200), isoTimestamp(now), expiresAt],
  );
  return { token, csrfToken, expiresAt };
}

/** Returns the signed-in user for a cookie token, or null when it is unknown, expired or deactivated. */
export function resolveSession(token: string): ResolvedSession | null {
  if (!token) return null;
  const row = getDb()
    .query<SessionJoinRow, [string, string]>(
      `SELECT users.*, sessions.csrf_token, sessions.expires_at
         FROM sessions
         JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.is_active = 1`,
    )
    .get(hashToken(token), isoTimestamp());
  if (!row) return null;
  const { csrf_token: csrfToken, expires_at: expiresAt, ...user } = row;
  return { user: user as UserRow, csrfToken, expiresAt };
}

export function destroySession(token: string): void {
  getDb().run("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
}

export function destroyAllSessionsForUser(userId: number): void {
  getDb().run("DELETE FROM sessions WHERE user_id = ?", [userId]);
}

export function countActiveSessions(userId: number): number {
  const row = getDb()
    .query<{ total: number }, [number, string]>(
      "SELECT COUNT(*) AS total FROM sessions WHERE user_id = ? AND expires_at > ?",
    )
    .get(userId, isoTimestamp());
  return row?.total ?? 0;
}

export function purgeExpiredSessions(): number {
  return getDb().run("DELETE FROM sessions WHERE expires_at <= ?", [isoTimestamp()]).changes;
}
