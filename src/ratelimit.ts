/**
 * Fixed-window rate limiting, held in process memory.
 *
 * auth-implement asks for a limit on login and reset that does not become a denial of service, so this
 * counts failures in a rolling window and forgets them when the window passes. There is no permanent
 * lockout: anyone who knows a student's email could otherwise lock that student out at will.
 *
 * Memory means the counters reset when the server restarts. For a single-machine college deployment that
 * is an accepted limit and it is written down in the README rather than hidden.
 */

import { rateLimited } from "./errors";

type Window = { count: number; resetAtMs: number };

const windowsByKey = new Map<string, Window>();

export type LimitPolicy = { maxAttempts: number; windowMinutes: number };

function currentWindow(key: string, windowMs: number, nowMs: number): Window {
  const existing = windowsByKey.get(key);
  if (existing && existing.resetAtMs > nowMs) return existing;
  const fresh: Window = { count: 0, resetAtMs: nowMs + windowMs };
  windowsByKey.set(key, fresh);
  return fresh;
}

/** Throws when the key is over its limit. Call before doing the expensive work. */
export function assertWithinLimit(key: string, policy: LimitPolicy, nowMs = Date.now()): void {
  const windowMs = policy.windowMinutes * 60 * 1000;
  const window = currentWindow(key, windowMs, nowMs);
  if (window.count >= policy.maxAttempts) {
    throw rateLimited((window.resetAtMs - nowMs) / 1000);
  }
}

export function recordFailure(key: string, policy: LimitPolicy, nowMs = Date.now()): void {
  const windowMs = policy.windowMinutes * 60 * 1000;
  const window = currentWindow(key, windowMs, nowMs);
  window.count += 1;
}

/** Called after a successful login so a student who eventually remembers is not still throttled. */
export function clearFailures(key: string): void {
  windowsByKey.delete(key);
}

export function resetAllLimits(): void {
  windowsByKey.clear();
}

export function prunePassedWindows(nowMs = Date.now()): void {
  for (const [key, window] of windowsByKey) {
    if (window.resetAtMs <= nowMs) windowsByKey.delete(key);
  }
}
