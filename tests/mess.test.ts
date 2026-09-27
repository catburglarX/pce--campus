/**
 * Mess menu and meal rating tests.
 *
 * The invariant worth protecting is one rating per student per meal per day, because without it the
 * averages can be stuffed by one annoyed student clicking five times.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  adminSession,
  call,
  callJson,
  registerStudentSession,
  startTestDatabase,
  stopTestDatabase,
  type TestSession,
} from "./helpers";
import { collegeDate, shiftDate } from "../src/domain/calendar";

type DaySnapshot = {
  date: string;
  canRate: boolean;
  meals: {
    meal: string;
    menuItems: string;
    aggregate: { ratingCount: number; averageStars: number | null };
    myRating: { stars: number; comment: string } | null;
  }[];
};

let student: TestSession;
let otherStudent: TestSession;
let admin: TestSession;
const today = collegeDate();

beforeAll(async () => {
  await startTestDatabase();
  student = await registerStudentSession("mess.rater@poornima.org", "Aarti Gupta");
  otherStudent = await registerStudentSession("mess.second@poornima.org", "Vikas Jain");
  admin = await adminSession();
});

afterAll(async () => {
  await stopTestDatabase();
});

async function rate(session: TestSession, payload: Record<string, unknown>) {
  return callJson<{ rating: { stars: number }; error: { message: string; field: string } }>(
    "POST",
    "/api/mess/ratings",
    { cookie: session.cookie, csrfToken: session.csrfToken, body: payload },
  );
}

async function readDay(session: TestSession, date: string) {
  return callJson<DaySnapshot>("GET", `/api/mess/day?date=${date}`, { cookie: session.cookie });
}

describe("mess menu", () => {
  test("the weekly menu covers seven days and four meals each", async () => {
    const { status, body } = await callJson<{ days: { weekday: number; meals: { items: string }[] }[] }>(
      "GET",
      "/api/mess/week",
      { cookie: student.cookie },
    );
    expect(status).toBe(200);
    expect(body.days).toHaveLength(7);
    for (const day of body.days) {
      expect(day.meals).toHaveLength(4);
      expect(day.meals.every((meal) => meal.items.length > 0)).toBe(true);
    }
  });

  test("today's snapshot carries the menu and says rating is open", async () => {
    const { status, body } = await readDay(student, today);
    expect(status).toBe(200);
    expect(body.date).toBe(today);
    expect(body.canRate).toBe(true);
    expect(body.meals).toHaveLength(4);
    expect(body.meals[0]?.menuItems.length).toBeGreaterThan(3);
  });

  test("only an admin can change the menu", async () => {
    const asStudent = await callJson("PUT", "/api/mess/menu", {
      cookie: student.cookie,
      csrfToken: student.csrfToken,
      body: { weekday: 1, meal: "lunch", items: "Student tried to change this" },
    });
    expect(asStudent.status).toBe(403);

    const asAdmin = await callJson<{ entry: { items: string } }>("PUT", "/api/mess/menu", {
      cookie: admin.cookie,
      csrfToken: admin.csrfToken,
      body: { weekday: 1, meal: "lunch", items: "Kadhi pakora, rice, roti, salad, chaas" },
    });
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.entry.items).toContain("Kadhi pakora");
  });
});

describe("rating a meal", () => {
  test("a rating is stored and shows up in the day's average", async () => {
    const created = await rate(student, {
      servedOn: today,
      meal: "lunch",
      stars: 2,
      taste: 2,
      hygiene: 3,
      quantity: 4,
      comment: "Dal was watery today.",
      isAnonymous: false,
    });
    expect(created.status).toBe(201);
    expect(created.body.rating.stars).toBe(2);

    const day = await readDay(student, today);
    const lunch = day.body.meals.find((meal) => meal.meal === "lunch");
    expect(lunch?.aggregate.ratingCount).toBe(1);
    expect(lunch?.aggregate.averageStars).toBe(2);
    expect(lunch?.myRating?.comment).toBe("Dal was watery today.");
  });

  test("rating the same meal twice updates instead of counting twice", async () => {
    const again = await rate(student, {
      servedOn: today,
      meal: "lunch",
      stars: 5,
      comment: "They brought fresh dal, much better.",
      isAnonymous: false,
    });
    expect(again.status).toBe(201);

    const day = await readDay(student, today);
    const lunch = day.body.meals.find((meal) => meal.meal === "lunch");
    expect(lunch?.aggregate.ratingCount).toBe(1);
    expect(lunch?.aggregate.averageStars).toBe(5);
  });

  test("a second student moves the average, and both ratings are counted", async () => {
    await rate(otherStudent, { servedOn: today, meal: "lunch", stars: 3, isAnonymous: false });
    const day = await readDay(student, today);
    const lunch = day.body.meals.find((meal) => meal.meal === "lunch");
    expect(lunch?.aggregate.ratingCount).toBe(2);
    expect(lunch?.aggregate.averageStars).toBe(4);
  });

  test("a future meal cannot be rated", async () => {
    const tomorrow = shiftDate(today, 1);
    const result = await rate(student, { servedOn: tomorrow, meal: "dinner", stars: 5 });
    expect(result.status).toBe(422);
    expect(result.body.error.message).toContain("not been served yet");
  });

  test("a meal older than the backdate window cannot be rated", async () => {
    const longAgo = shiftDate(today, -30);
    const result = await rate(student, { servedOn: longAgo, meal: "dinner", stars: 1 });
    expect(result.status).toBe(422);
    expect(result.body.error.field).toBe("servedOn");
  });

  test("stars outside one to five are refused", async () => {
    const tooHigh = await rate(student, { servedOn: today, meal: "dinner", stars: 9 });
    const tooLow = await rate(student, { servedOn: today, meal: "dinner", stars: 0 });
    expect(tooHigh.status).toBe(422);
    expect(tooLow.status).toBe(422);
  });

  test("an unknown meal name is refused", async () => {
    const result = await rate(student, { servedOn: today, meal: "brunch", stars: 4 });
    expect(result.status).toBe(422);
  });
});

describe("anonymity and ownership", () => {
  test("an anonymous rating does not show the author to another student", async () => {
    await rate(student, {
      servedOn: today,
      meal: "breakfast",
      stars: 1,
      comment: "Poha was cold.",
      isAnonymous: true,
    });
    const { body } = await callJson<{ ratings: { authorName: string; isMine: boolean; comment: string }[] }>(
      "GET",
      `/api/mess/ratings?date=${today}&meal=breakfast`,
      { cookie: otherStudent.cookie },
    );
    const entry = body.ratings.find((rating) => rating.comment === "Poha was cold.");
    expect(entry?.authorName).toBe("Anonymous student");
    expect(entry?.isMine).toBe(false);
  });

  test("a student cannot delete another student's rating", async () => {
    await rate(otherStudent, { servedOn: today, meal: "snacks", stars: 4, comment: "Samosa was hot." });
    const listed = await callJson<{ ratings: { id: number; isMine: boolean }[] }>(
      "GET",
      `/api/mess/ratings?date=${today}&meal=snacks`,
      { cookie: student.cookie },
    );
    const notMine = listed.body.ratings.find((rating) => !rating.isMine);
    expect(notMine).toBeDefined();

    const attempt = await call("DELETE", `/api/mess/ratings/${notMine?.id}`, {
      cookie: student.cookie,
      csrfToken: student.csrfToken,
    });
    expect(attempt.status).toBe(404);

    const owner = await call("DELETE", `/api/mess/ratings/${notMine?.id}`, {
      cookie: otherStudent.cookie,
      csrfToken: otherStudent.csrfToken,
    });
    expect(owner.status).toBe(200);
  });
});

describe("trend", () => {
  test("the trend returns one point per day, ending today", async () => {
    const { status, body } = await callJson<{ points: { date: string; averageStars: number | null }[] }>(
      "GET",
      "/api/mess/trend?days=7",
      { cookie: student.cookie },
    );
    expect(status).toBe(200);
    expect(body.points).toHaveLength(7);
    expect(body.points.at(-1)?.date).toBe(today);
    expect(body.points.at(-1)?.averageStars).not.toBeNull();
  });
});
