/**
 * Who may act on which record.
 *
 * These are pure decisions over ids and roles, kept apart from the database so the same rule is used
 * by every route and can be tested by swapping one identifier. auth-implement treats missing
 * object-level checks as the first defect to look for, so the checks live in one file.
 */

export type Actor = { id: number; role: "student" | "admin" };
export type OwnedRecord = { user_id: number };

export function isAdmin(actor: Actor): boolean {
  return actor.role === "admin";
}

export function ownsRecord(actor: Actor, record: OwnedRecord): boolean {
  return record.user_id === actor.id;
}

/** Only the author edits their own words. An admin may hide a review but never rewrite it. */
export function canEditOwnContent(actor: Actor, record: OwnedRecord): boolean {
  return ownsRecord(actor, record);
}

export function canDeleteContent(actor: Actor, record: OwnedRecord): boolean {
  return ownsRecord(actor, record) || isAdmin(actor);
}

export function canModerate(actor: Actor): boolean {
  return isAdmin(actor);
}

/** A complaint may be withdrawn by its author only while nobody has started working on it. */
export function canWithdrawComplaint(actor: Actor, complaint: OwnedRecord & { status: string }): boolean {
  if (isAdmin(actor)) return true;
  return ownsRecord(actor, complaint) && complaint.status === "open";
}

export type MealRatingWindow = {
  servedOn: string;
  today: string;
  backdateDays: number;
};

export type RatingWindowVerdict = { allowed: boolean; reason: string };

/**
 * A meal may be rated for today or for a recent past day, never for the future. Without the future
 * check a student could rate next month's dinner today, which would make the averages fiction.
 */
export function mealRatingWindow(window: MealRatingWindow, dayGap: number): RatingWindowVerdict {
  if (dayGap > 0) {
    return { allowed: false, reason: "That meal has not been served yet." };
  }
  if (Math.abs(dayGap) > window.backdateDays) {
    return {
      allowed: false,
      reason: `You can only rate meals from the last ${window.backdateDays} days.`,
    };
  }
  return { allowed: true, reason: "" };
}
