/**
 * Input validation primitives.
 *
 * These run at the HTTP edge. Everything past them may assume its arguments are the right type, in
 * range, and trimmed, which is what keeps the service layer free of defensive checks.
 */

import { validationError } from "./errors";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export function requireString(
  value: unknown,
  field: string,
  limits: { min?: number; max: number },
): string {
  if (typeof value !== "string") throw validationError(`${field} is required.`, field);
  const trimmed = value.trim();
  const min = limits.min ?? 1;
  if (trimmed.length < min) {
    throw validationError(`${field} must be at least ${min} character(s).`, field);
  }
  if (trimmed.length > limits.max) {
    throw validationError(`${field} must be ${limits.max} characters or fewer.`, field);
  }
  return trimmed;
}

export function optionalString(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null || value === "") return "";
  return requireString(value, field, { min: 1, max });
}

export function requireInteger(
  value: unknown,
  field: string,
  range: { min: number; max: number },
): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed)) {
    throw validationError(`${field} must be a whole number.`, field);
  }
  if (parsed < range.min || parsed > range.max) {
    throw validationError(`${field} must be between ${range.min} and ${range.max}.`, field);
  }
  return parsed;
}

export function optionalInteger(
  value: unknown,
  field: string,
  range: { min: number; max: number },
): number | null {
  if (value === undefined || value === null || value === "") return null;
  return requireInteger(value, field, range);
}

export function requireEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw validationError(`${field} must be one of: ${allowed.join(", ")}.`, field);
  }
  return value as T;
}

export function requireBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1" || value === "on";
}

export function requireEmail(value: unknown): string {
  const email = requireString(value, "Email", { min: 5, max: 160 }).toLowerCase();
  if (!EMAIL_SHAPE.test(email)) throw validationError("That does not look like an email address.", "email");
  return email;
}

export function requireIsoDate(value: unknown, field: string): string {
  const raw = requireString(value, field, { min: 10, max: 10 });
  if (!DATE_SHAPE.test(raw)) throw validationError(`${field} must look like 2026-09-22.`, field);
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw validationError(`${field} is not a real date.`, field);
  return raw;
}

export function requireId(value: unknown, field = "Identifier"): number {
  return requireInteger(value, field, { min: 1, max: Number.MAX_SAFE_INTEGER });
}
