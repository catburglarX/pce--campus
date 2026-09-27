/**
 * User accounts: registration, credential verification, password change, and the admin-side roster.
 *
 * Password hashing is argon2id at the cost parameters below. They are recorded in the module so they can
 * be raised later and old hashes rehashed on next login.
 */

import { getDb } from "../db/connection";
import { config } from "../config";
import { conflict, forbidden, notFound, unauthenticated, validationError } from "../errors";
import { checkPasswordStrength } from "../domain/password-policy";
import { isoTimestamp } from "../domain/calendar";
import type { Actor } from "../domain/access-rules";
import { destroyAllSessionsForUser } from "./sessions";
import { recordAuditEntry } from "./audit";

/** OWASP's Argon2id reference parameters: 19 MiB of memory, two passes, one lane. */
const ARGON2_COST = { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 } as const;

export type UserRole = "student" | "admin";

export type UserRow = {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  role: UserRole;
  branch: string;
  study_year: number | null;
  is_hostel_resident: number;
  is_active: number;
  created_at: string;
  password_changed_at: string;
};

export type PublicUser = {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  branch: string;
  studyYear: number | null;
  isHostelResident: boolean;
  createdAt: string;
};

export type RegistrationInput = {
  name: string;
  email: string;
  password: string;
  joinCode: string;
  branch: string;
  studyYear: number | null;
  isHostelResident: boolean;
};

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    branch: row.branch,
    studyYear: row.study_year,
    isHostelResident: row.is_hostel_resident === 1,
    createdAt: row.created_at,
  };
}

export function findUserByEmail(email: string): UserRow | null {
  return getDb()
    .query<UserRow, [string]>("SELECT * FROM users WHERE email = ? COLLATE NOCASE")
    .get(email.toLowerCase());
}

export function findUserById(id: number): UserRow | null {
  return getDb().query<UserRow, [number]>("SELECT * FROM users WHERE id = ?").get(id);
}

export function emailDomainAllowed(email: string): boolean {
  const domains = config.allowedEmailDomains;
  if (domains.includes("*")) return true;
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return domains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, ARGON2_COST);
}

/** True when a stored hash predates current policy and should be replaced on successful login. */
export function hashNeedsUpgrade(passwordHash: string): boolean {
  return !passwordHash.startsWith("$argon2id$");
}

function assertJoinCode(supplied: string): void {
  if (supplied.trim() !== config.joinCode) {
    throw forbidden("That join code is not valid. Ask the admin for the current code.");
  }
}

export async function registerStudent(input: RegistrationInput): Promise<PublicUser> {
  assertJoinCode(input.joinCode);
  if (!emailDomainAllowed(input.email)) {
    throw validationError(
      `Registration is limited to college email addresses (${config.allowedEmailDomains.join(", ")}).`,
      "email",
    );
  }
  const verdict = checkPasswordStrength(input.password, input.email);
  if (!verdict.acceptable) throw validationError(verdict.reason, "password");
  if (findUserByEmail(input.email)) {
    throw conflict("An account already exists for that email. Sign in instead.", "email");
  }

  const now = isoTimestamp();
  const passwordHash = await hashPassword(input.password);
  const created = getDb()
    .query<{ id: number }, [string, string, string, string, number | null, number, string, string]>(
      `INSERT INTO users (email, name, password_hash, branch, study_year, is_hostel_resident, created_at, password_changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      input.email.toLowerCase(),
      input.name,
      passwordHash,
      input.branch,
      input.studyYear,
      input.isHostelResident ? 1 : 0,
      now,
      now,
    );
  if (!created) throw new Error(`Registration insert returned no row for ${input.email}`);
  const row = findUserById(created.id);
  if (!row) throw new Error(`Registered user ${created.id} could not be read back`);
  return toPublicUser(row);
}

/**
 * Verify an email and password pair.
 *
 * A missing account still pays for one hash comparison, so response time does not reveal which emails
 * are registered.
 */
export async function verifyCredentials(email: string, password: string): Promise<UserRow> {
  const row = findUserByEmail(email);
  if (!row) {
    await Bun.password.verify(password, await hashPassword("decoy-for-constant-work"));
    throw unauthenticated("Email or password is wrong.");
  }
  const matches = await Bun.password.verify(password, row.password_hash);
  if (!matches) throw unauthenticated("Email or password is wrong.");
  if (row.is_active !== 1) throw forbidden("This account has been deactivated by the admin.");
  if (hashNeedsUpgrade(row.password_hash)) {
    const upgraded = await hashPassword(password);
    getDb().run("UPDATE users SET password_hash = ? WHERE id = ?", [upgraded, row.id]);
  }
  return row;
}

/** Changes the password and drops every session for the account, including the caller's. */
export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const row = findUserById(userId);
  if (!row) throw notFound("Account");
  const matches = await Bun.password.verify(currentPassword, row.password_hash);
  if (!matches) throw unauthenticated("Your current password is wrong.");
  const verdict = checkPasswordStrength(newPassword, row.email);
  if (!verdict.acceptable) throw validationError(verdict.reason, "newPassword");
  if (await Bun.password.verify(newPassword, row.password_hash)) {
    throw validationError("The new password must be different from the current one.", "newPassword");
  }
  const now = isoTimestamp();
  getDb().run("UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?", [
    await hashPassword(newPassword),
    now,
    userId,
  ]);
  destroyAllSessionsForUser(userId);
}

export function updateProfile(
  userId: number,
  profile: { name: string; branch: string; studyYear: number | null; isHostelResident: boolean },
): PublicUser {
  getDb().run(
    "UPDATE users SET name = ?, branch = ?, study_year = ?, is_hostel_resident = ? WHERE id = ?",
    [profile.name, profile.branch, profile.studyYear, profile.isHostelResident ? 1 : 0, userId],
  );
  const row = findUserById(userId);
  if (!row) throw notFound("Account");
  return toPublicUser(row);
}

export function listUsers(): PublicUser[] {
  return getDb()
    .query<UserRow, []>("SELECT * FROM users ORDER BY role DESC, name COLLATE NOCASE")
    .all()
    .map(toPublicUser);
}

/**
 * Role and activation changes.
 *
 * Both take an Actor rather than a bare id, matching every other service, because a number and an object
 * are interchangeable at a call site and the mistake disables the "not yourself" check silently. The
 * write and its audit entry share a transaction so a failure cannot leave a change with no record.
 */
export function setUserRole(actor: Actor, targetUserId: number, role: UserRole): PublicUser {
  const target = findUserById(targetUserId);
  if (!target) throw notFound("Student");
  if (target.id === actor.id) throw forbidden("You cannot change your own role.");
  getDb().transaction(() => {
    getDb().run("UPDATE users SET role = ? WHERE id = ?", [role, targetUserId]);
    recordAuditEntry(actor.id, "user.role_changed", "user", targetUserId, `role set to ${role}`);
  })();
  const updated = findUserById(targetUserId);
  if (!updated) throw notFound("Student");
  return toPublicUser(updated);
}

export function setUserActive(actor: Actor, targetUserId: number, isActive: boolean): PublicUser {
  const target = findUserById(targetUserId);
  if (!target) throw notFound("Student");
  if (target.id === actor.id) throw forbidden("You cannot deactivate your own account.");
  getDb().transaction(() => {
    getDb().run("UPDATE users SET is_active = ? WHERE id = ?", [isActive ? 1 : 0, targetUserId]);
    recordAuditEntry(
      actor.id,
      isActive ? "user.reactivated" : "user.deactivated",
      "user",
      targetUserId,
      target.email,
    );
  })();
  if (!isActive) destroyAllSessionsForUser(targetUserId);
  const updated = findUserById(targetUserId);
  if (!updated) throw notFound("Student");
  return toPublicUser(updated);
}
