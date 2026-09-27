/**
 * Campus review tests.
 *
 * The important ones swap an identifier: signed in as one student, act on another student's review. That
 * is the defect auth-implement says survives review most often, so it is tested directly rather than
 * assumed from the presence of a guard.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  adminSession,
  call,
  callJson,
  firstCategoryId,
  registerStudentSession,
  startTestDatabase,
  stopTestDatabase,
  type TestSession,
} from "./helpers";

type Review = {
  id: number;
  title: string;
  body: string;
  stars: number;
  status: string;
  hiddenReason: string;
  authorName: string;
  isMine: boolean;
  helpfulCount: number;
  iFoundHelpful: boolean;
  commentCount: number;
  categorySlug: string;
};

let author: TestSession;
let bystander: TestSession;
let admin: TestSession;
let hostelCategoryId = 0;
let libraryCategoryId = 0;

beforeAll(async () => {
  await startTestDatabase();
  author = await registerStudentSession("review.author@poornima.org", "Nikhil Verma");
  bystander = await registerStudentSession("review.other@poornima.org", "Sneha Agarwal");
  admin = await adminSession();
  hostelCategoryId = await firstCategoryId(author, "hostel");
  libraryCategoryId = await firstCategoryId(author, "library");
});

afterAll(async () => {
  await stopTestDatabase();
});

async function postReview(session: TestSession, overrides: Record<string, unknown> = {}) {
  return callJson<{ review: Review; error: { message: string; field: string } }>("POST", "/api/reviews", {
    cookie: session.cookie,
    csrfToken: session.csrfToken,
    body: {
      categoryId: hostelCategoryId,
      subject: "Hostel block C",
      title: "Water supply stops after 9 pm",
      body: "Taps run dry every night in block C and the tank is not refilled until morning.",
      stars: 2,
      isAnonymous: false,
      ...overrides,
    },
  });
}

describe("writing a review", () => {
  test("a review is created and listed", async () => {
    const created = await postReview(author);
    expect(created.status).toBe(201);
    expect(created.body.review.isMine).toBe(true);
    expect(created.body.review.categorySlug).toBe("hostel");

    const listed = await callJson<{ items: Review[]; total: number }>("GET", "/api/reviews", {
      cookie: bystander.cookie,
    });
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBeGreaterThan(0);
    expect(listed.body.items.some((item) => item.id === created.body.review.id)).toBe(true);
  });

  test("a short title or body is refused", async () => {
    const shortTitle = await postReview(author, { title: "Bad" });
    const shortBody = await postReview(author, { body: "too short" });
    expect(shortTitle.status).toBe(422);
    expect(shortBody.status).toBe(422);
  });

  test("an unknown category is refused", async () => {
    const result = await postReview(author, { categoryId: 9999 });
    expect(result.status).toBe(404);
  });

  test("an anonymous review hides the author from other students but not from the author", async () => {
    const created = await postReview(author, {
      categoryId: libraryCategoryId,
      title: "Reading room is too noisy",
      body: "Group study happens in the silent zone and nobody stops it during exam weeks.",
      isAnonymous: true,
      stars: 3,
    });
    expect(created.status).toBe(201);

    const asOther = await callJson<{ review: Review }>("GET", `/api/reviews/${created.body.review.id}`, {
      cookie: bystander.cookie,
    });
    const asAuthor = await callJson<{ review: Review }>("GET", `/api/reviews/${created.body.review.id}`, {
      cookie: author.cookie,
    });
    expect(asOther.body.review.authorName).toBe("Anonymous student");
    expect(asAuthor.body.review.authorName).toBe("Nikhil Verma");
  });
});

describe("object level authorisation", () => {
  test("another student cannot edit a review they do not own", async () => {
    const created = await postReview(author);
    const attempt = await callJson<{ error: { message: string } }>(
      "PATCH",
      `/api/reviews/${created.body.review.id}`,
      {
        cookie: bystander.cookie,
        csrfToken: bystander.csrfToken,
        body: {
          categoryId: hostelCategoryId,
          title: "Edited by somebody else entirely",
          body: "This edit should never be accepted by the server.",
          stars: 5,
        },
      },
    );
    expect(attempt.status).toBe(403);

    const unchanged = await callJson<{ review: Review }>("GET", `/api/reviews/${created.body.review.id}`, {
      cookie: author.cookie,
    });
    expect(unchanged.body.review.title).toBe("Water supply stops after 9 pm");
  });

  test("the author can edit their own review", async () => {
    const created = await postReview(author);
    const edited = await callJson<{ review: Review }>("PATCH", `/api/reviews/${created.body.review.id}`, {
      cookie: author.cookie,
      csrfToken: author.csrfToken,
      body: {
        categoryId: hostelCategoryId,
        title: "Water supply fixed after complaint",
        body: "The tank is now refilled at night, so this is no longer a problem in block C.",
        stars: 4,
      },
    });
    expect(edited.status).toBe(200);
    expect(edited.body.review.stars).toBe(4);
  });

  test("another student cannot delete a review, but an admin can", async () => {
    const created = await postReview(author);
    const byOther = await call("DELETE", `/api/reviews/${created.body.review.id}`, {
      cookie: bystander.cookie,
      csrfToken: bystander.csrfToken,
    });
    expect(byOther.status).toBe(403);

    const byAdmin = await call("DELETE", `/api/reviews/${created.body.review.id}`, {
      cookie: admin.cookie,
      csrfToken: admin.csrfToken,
    });
    expect(byAdmin.status).toBe(200);

    const gone = await callJson("GET", `/api/reviews/${created.body.review.id}`, { cookie: author.cookie });
    expect(gone.status).toBe(404);
  });

  test("a student cannot reach an admin endpoint", async () => {
    const reports = await callJson("GET", "/api/admin/reports", { cookie: bystander.cookie });
    const roster = await callJson("GET", "/api/admin/roster", { cookie: bystander.cookie });
    expect(reports.status).toBe(403);
    expect(roster.status).toBe(403);
  });
});

describe("helpful votes and reports", () => {
  test("marking helpful toggles and cannot be used on your own review", async () => {
    const created = await postReview(author);
    const reviewId = created.body.review.id;

    const own = await callJson("POST", `/api/reviews/${reviewId}/helpful`, {
      cookie: author.cookie,
      csrfToken: author.csrfToken,
    });
    expect(own.status).toBe(403);

    const up = await callJson<{ reviewId: number; helpfulCount: number; iFoundHelpful: boolean }>(
      "POST",
      `/api/reviews/${reviewId}/helpful`,
      { cookie: bystander.cookie, csrfToken: bystander.csrfToken },
    );
    expect(up.body).toEqual({ reviewId, helpfulCount: 1, iFoundHelpful: true });

    const down = await callJson<{ reviewId: number; helpfulCount: number; iFoundHelpful: boolean }>(
      "POST",
      `/api/reviews/${reviewId}/helpful`,
      { cookie: bystander.cookie, csrfToken: bystander.csrfToken },
    );
    expect(down.body).toEqual({ reviewId, helpfulCount: 0, iFoundHelpful: false });
  });

  test("a review can be reported once, and the admin sees it in the queue", async () => {
    const created = await postReview(author, { title: "This one will be reported" });
    const reviewId = created.body.review.id;
    const first = await callJson("POST", `/api/reviews/${reviewId}/report`, {
      cookie: bystander.cookie,
      csrfToken: bystander.csrfToken,
      body: { reason: "Names a specific staff member rudely" },
    });
    expect(first.status).toBe(201);

    const duplicate = await callJson("POST", `/api/reviews/${reviewId}/report`, {
      cookie: bystander.cookie,
      csrfToken: bystander.csrfToken,
      body: { reason: "Reporting again to inflate the count" },
    });
    expect(duplicate.status).toBe(409);

    const queue = await callJson<{ reports: { id: number; flagReasons: string[] }[] }>(
      "GET",
      "/api/admin/reports",
      { cookie: admin.cookie },
    );
    const entry = queue.body.reports.find((report) => report.id === reviewId);
    expect(entry?.flagReasons[0]).toContain("staff member");
  });
});

describe("moderation", () => {
  test("an admin hides a review with a reason, and the author still sees why", async () => {
    const created = await postReview(author, { title: "Review that will be hidden" });
    const reviewId = created.body.review.id;

    const studentAttempt = await callJson("POST", `/api/admin/reviews/${reviewId}/hide`, {
      cookie: bystander.cookie,
      csrfToken: bystander.csrfToken,
      body: { reason: "I do not like it" },
    });
    expect(studentAttempt.status).toBe(403);

    const hidden = await callJson<{ review: Review }>("POST", `/api/admin/reviews/${reviewId}/hide`, {
      cookie: admin.cookie,
      csrfToken: admin.csrfToken,
      body: { reason: "Contains a personal insult" },
    });
    expect(hidden.status).toBe(200);
    expect(hidden.body.review.status).toBe("hidden");

    const asOther = await callJson("GET", `/api/reviews/${reviewId}`, { cookie: bystander.cookie });
    expect(asOther.status).toBe(404);

    const asAuthor = await callJson<{ review: Review }>("GET", `/api/reviews/${reviewId}`, {
      cookie: author.cookie,
    });
    expect(asAuthor.body.review.hiddenReason).toBe("Contains a personal insult");

    const restored = await callJson<{ review: Review }>("POST", `/api/admin/reviews/${reviewId}/restore`, {
      cookie: admin.cookie,
      csrfToken: admin.csrfToken,
    });
    expect(restored.body.review.status).toBe("visible");
  });

  test("hiding without a reason is refused", async () => {
    const created = await postReview(author, { title: "Hide me with no reason given" });
    const result = await callJson<{ error: { field: string } }>(
      "POST",
      `/api/admin/reviews/${created.body.review.id}/hide`,
      { cookie: admin.cookie, csrfToken: admin.csrfToken, body: { reason: "   " } },
    );
    expect(result.status).toBe(422);
    expect(result.body.error.field).toBe("reason");
  });
});

describe("replies", () => {
  test("students reply, and only the author or an admin can delete a reply", async () => {
    const created = await postReview(author, { title: "Thread about bus timing" });
    const reviewId = created.body.review.id;

    const reply = await callJson<{ comment: { id: number; authorName: string } }>(
      "POST",
      `/api/reviews/${reviewId}/comments`,
      {
        cookie: bystander.cookie,
        csrfToken: bystander.csrfToken,
        body: { body: "Route 4 is late every Monday as well.", isAnonymous: false },
      },
    );
    expect(reply.status).toBe(201);

    const withComments = await callJson<{ comments: { id: number }[] }>("GET", `/api/reviews/${reviewId}`, {
      cookie: author.cookie,
    });
    expect(withComments.body.comments).toHaveLength(1);

    const wrongUser = await call("DELETE", `/api/comments/${reply.body.comment.id}`, {
      cookie: author.cookie,
      csrfToken: author.csrfToken,
    });
    expect(wrongUser.status).toBe(403);

    const owner = await call("DELETE", `/api/comments/${reply.body.comment.id}`, {
      cookie: bystander.cookie,
      csrfToken: bystander.csrfToken,
    });
    expect(owner.status).toBe(200);
  });
});

describe("listing", () => {
  test("filter by category, search text and sort by helpful all work", async () => {
    const byCategory = await callJson<{ items: Review[] }>("GET", "/api/reviews?category=library", {
      cookie: bystander.cookie,
    });
    expect(byCategory.body.items.every((item) => item.categorySlug === "library")).toBe(true);

    const bySearch = await callJson<{ items: Review[]; total: number }>("GET", "/api/reviews?q=noisy", {
      cookie: bystander.cookie,
    });
    expect(bySearch.body.total).toBeGreaterThan(0);
    expect(bySearch.body.items[0]?.title).toContain("noisy");

    const bySort = await callJson<{ items: Review[] }>("GET", "/api/reviews?sort=helpful&pageSize=50", {
      cookie: bystander.cookie,
    });
    const counts = bySort.body.items.map((item) => item.helpfulCount);
    expect([...counts].sort((left, right) => right - left)).toEqual(counts);

    const mineOnly = await callJson<{ items: Review[] }>("GET", "/api/reviews?mine=1", {
      cookie: author.cookie,
    });
    expect(mineOnly.body.items.every((item) => item.isMine)).toBe(true);

    const badSort = await callJson("GET", "/api/reviews?sort=whatever", { cookie: author.cookie });
    expect(badSort.status).toBe(422);
  });

  test("pagination returns the page size asked for and a real total", async () => {
    const firstPage = await callJson<{ items: Review[]; total: number; page: number }>(
      "GET",
      "/api/reviews?page=1&pageSize=2",
      { cookie: bystander.cookie },
    );
    expect(firstPage.body.items.length).toBeLessThanOrEqual(2);
    expect(firstPage.body.page).toBe(1);
    expect(firstPage.body.total).toBeGreaterThanOrEqual(firstPage.body.items.length);
  });
});
