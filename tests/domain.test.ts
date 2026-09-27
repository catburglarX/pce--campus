/**
 * Unit tests for the pure parts: dates, rating maths, access rules, password policy, routing and the
 * static path guard. No database and no clock, so these are the tests that stay correct for years.
 */

import { describe, expect, test } from "bun:test";

import {
  collegeDate,
  dateSeriesEndingAt,
  daysBetween,
  formatDayLabel,
  shiftDate,
  weekdayName,
  weekdayOf,
} from "../src/domain/calendar";
import { averageStars, scoreVerdict, starDistribution, starsAsPercent } from "../src/domain/rating";
import {
  canDeleteContent,
  canEditOwnContent,
  canWithdrawComplaint,
  mealRatingWindow,
} from "../src/domain/access-rules";
import { checkPasswordStrength } from "../src/domain/password-policy";
import { matchRoute, pathExistsForOtherMethod, type Route } from "../src/router";
import { resolvePublicPath } from "../src/static-files";

const student = { id: 7, role: "student" } as const;
const otherStudent = { id: 8, role: "student" } as const;
const admin = { id: 1, role: "admin" } as const;

describe("calendar", () => {
  test("the college date uses the India time zone, not UTC", () => {
    // 22:00 UTC on 21 September is already 03:30 on 22 September in Jaipur.
    const lateEvening = new Date("2026-09-21T22:00:00Z");
    expect(collegeDate(lateEvening)).toBe("2026-09-22");
    expect(collegeDate(lateEvening, "UTC")).toBe("2026-09-21");
  });

  test("weekday numbering matches the menu table, Sunday is zero", () => {
    expect(weekdayOf("2026-09-20")).toBe(0);
    expect(weekdayName(0)).toBe("Sunday");
    expect(weekdayOf("2026-09-22")).toBe(2);
    expect(weekdayName(weekdayOf("2026-09-22"))).toBe("Tuesday");
  });

  test("date arithmetic crosses month and year boundaries", () => {
    expect(shiftDate("2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftDate("2027-01-01", -1)).toBe("2026-12-31");
    expect(daysBetween("2026-09-22", "2026-09-29")).toBe(7);
    expect(daysBetween("2026-09-29", "2026-09-22")).toBe(-7);
  });

  test("a trend series ends on the given day and runs oldest first", () => {
    const series = dateSeriesEndingAt("2026-09-22", 5);
    expect(series).toEqual(["2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22"]);
    expect(formatDayLabel("2026-09-22")).toBe("Tue 22/09");
  });
});

describe("rating maths", () => {
  test("an average is rounded to one decimal and empty means null", () => {
    expect(averageStars([])).toBeNull();
    expect(averageStars([5, 4])).toBe(4.5);
    expect(averageStars([1, 2, 2])).toBe(1.7);
  });

  test("a distribution always has five buckets", () => {
    const spread = starDistribution([5, 5, 3]);
    expect(spread).toHaveLength(5);
    expect(spread.find((bucket) => bucket.stars === 5)?.count).toBe(2);
    expect(spread.find((bucket) => bucket.stars === 1)?.count).toBe(0);
  });

  test("verdicts and bar widths follow the score", () => {
    expect(scoreVerdict(null)).toBe("Not rated yet");
    expect(scoreVerdict(4.6)).toBe("Excellent");
    expect(scoreVerdict(2.5)).toBe("Average");
    expect(scoreVerdict(1.2)).toBe("Very poor");
    expect(starsAsPercent(null)).toBe(0);
    expect(starsAsPercent(5)).toBe(100);
    expect(starsAsPercent(2.5)).toBe(50);
  });
});

describe("access rules", () => {
  test("editing is limited to the author, even for an admin", () => {
    const record = { user_id: student.id };
    expect(canEditOwnContent(student, record)).toBe(true);
    expect(canEditOwnContent(otherStudent, record)).toBe(false);
    expect(canEditOwnContent(admin, record)).toBe(false);
  });

  test("deleting is allowed for the author or an admin", () => {
    const record = { user_id: student.id };
    expect(canDeleteContent(student, record)).toBe(true);
    expect(canDeleteContent(admin, record)).toBe(true);
    expect(canDeleteContent(otherStudent, record)).toBe(false);
  });

  test("a complaint can only be withdrawn by its author while open", () => {
    const open = { user_id: student.id, status: "open" };
    const started = { user_id: student.id, status: "in_progress" };
    expect(canWithdrawComplaint(student, open)).toBe(true);
    expect(canWithdrawComplaint(student, started)).toBe(false);
    expect(canWithdrawComplaint(admin, started)).toBe(true);
    expect(canWithdrawComplaint(otherStudent, open)).toBe(false);
  });

  test("the rating window rejects the future and anything past the backdate limit", () => {
    const window = { servedOn: "2026-09-22", today: "2026-09-22", backdateDays: 7 };
    expect(mealRatingWindow(window, 0).allowed).toBe(true);
    expect(mealRatingWindow(window, -7).allowed).toBe(true);
    expect(mealRatingWindow(window, -8).allowed).toBe(false);
    expect(mealRatingWindow(window, 1).reason).toContain("not been served yet");
  });
});

describe("password policy", () => {
  test("length is the first requirement", () => {
    expect(checkPasswordStrength("short1").acceptable).toBe(false);
    expect(checkPasswordStrength("mess-roti-is-cold-42").acceptable).toBe(true);
  });

  test("breached and college-guessable passwords are refused whatever the case", () => {
    expect(checkPasswordStrength("password123").acceptable).toBe(false);
    expect(checkPasswordStrength("Poornima123").acceptable).toBe(false);
    expect(checkPasswordStrength("PCECampus").acceptable).toBe(false);
  });

  test("a password containing the email name is refused", () => {
    const verdict = checkPasswordStrength("rahulsharma-hostel", "rahulsharma@poornima.org");
    expect(verdict.acceptable).toBe(false);
    expect(verdict.reason).toContain("email name");
  });

  test("one repeated character is not a password", () => {
    expect(checkPasswordStrength("aaaaaaaaaaaa").acceptable).toBe(false);
  });
});

describe("router", () => {
  const routes: Route[] = [
    { method: "GET", pattern: "/api/reviews", handler: () => new Response("list") },
    { method: "GET", pattern: "/api/reviews/:id", handler: () => new Response("one") },
    { method: "POST", pattern: "/api/reviews/:id/helpful", handler: () => new Response("vote") },
  ];

  test("a parameter segment is captured and decoded", () => {
    const match = matchRoute(routes, "GET", "/api/reviews/42");
    expect(match?.params).toEqual({ id: "42" });
  });

  test("a longer path does not fall through to a shorter pattern", () => {
    expect(matchRoute(routes, "GET", "/api/reviews/42/helpful")).toBeNull();
    expect(matchRoute(routes, "POST", "/api/reviews/42/helpful")).not.toBeNull();
  });

  test("a known path with the wrong method is distinguishable from an unknown path", () => {
    expect(matchRoute(routes, "DELETE", "/api/reviews/42")).toBeNull();
    expect(pathExistsForOtherMethod(routes, "/api/reviews/42")).toBe(true);
    expect(pathExistsForOtherMethod(routes, "/api/nothing/here")).toBe(false);
  });
});

describe("static path guard", () => {
  test("a normal asset path resolves", () => {
    expect(resolvePublicPath("/css/app.css")).not.toBeNull();
  });

  test("traversal outside public is refused", () => {
    expect(resolvePublicPath("/css/../../src/config.ts")).toBeNull();
    expect(resolvePublicPath("/../package.json")).toBeNull();
    expect(resolvePublicPath("/css/..%2f..%2fsrc/server.ts")).toBeNull();
  });
});
