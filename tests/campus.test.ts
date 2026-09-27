/**
 * Complaint workflow, notice board, roster and dashboard tests.
 *
 * The workflow rules worth testing are the ones a student could otherwise route around: changing a
 * status without being an admin, withdrawing a complaint after work has started, and closing one with no
 * explanation.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  adminSession,
  call,
  callJson,
  firstCategoryId,
  loginSession,
  registerStudentSession,
  startTestDatabase,
  stopTestDatabase,
  STRONG_PASSWORD,
  type TestSession,
} from "./helpers";

type Complaint = {
  id: number;
  title: string;
  status: string;
  severity: string;
  supportCount: number;
  iSupport: boolean;
  isMine: boolean;
  resolutionNote: string;
  resolvedByName: string | null;
  authorName: string;
};

type Notice = { id: number; title: string; isPinned: boolean; authorName: string };

let complainer: TestSession;
let bystander: TestSession;
let admin: TestSession;
let washroomCategoryId = 0;

beforeAll(async () => {
  await startTestDatabase();
  complainer = await registerStudentSession("complaint.raiser@poornima.org", "Deepak Yadav");
  bystander = await registerStudentSession("complaint.other@poornima.org", "Ritu Saini");
  admin = await adminSession();
  washroomCategoryId = await firstCategoryId(complainer, "washrooms");
});

afterAll(async () => {
  await stopTestDatabase();
});

async function raiseComplaint(session: TestSession, overrides: Record<string, unknown> = {}) {
  return callJson<{ complaint: Complaint; error: { field: string; message: string } }>(
    "POST",
    "/api/complaints",
    {
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      body: {
        categoryId: washroomCategoryId,
        title: "Second floor washroom has no water",
        body: "The tap has been dry for three days and the floor is not being cleaned.",
        location: "Academic block B, second floor",
        severity: "high",
        isAnonymous: false,
        ...overrides,
      },
    },
  );
}

describe("raising a complaint", () => {
  test("a complaint starts open and is listed", async () => {
    const created = await raiseComplaint(complainer);
    expect(created.status).toBe(201);
    expect(created.body.complaint.status).toBe("open");
    expect(created.body.complaint.severity).toBe("high");

    const listed = await callJson<{ complaints: Complaint[] }>("GET", "/api/complaints?status=open", {
      cookie: bystander.cookie,
    });
    expect(listed.body.complaints.some((entry) => entry.id === created.body.complaint.id)).toBe(true);
  });

  test("an unknown severity is refused", async () => {
    const result = await raiseComplaint(complainer, { severity: "catastrophic" });
    expect(result.status).toBe(422);
  });

  test("another student can add support, the author cannot", async () => {
    const created = await raiseComplaint(complainer, { title: "Hostel wifi drops every evening" });
    const id = created.body.complaint.id;

    const ownAttempt = await callJson("POST", `/api/complaints/${id}/support`, {
      cookie: complainer.cookie,
      csrfToken: complainer.csrfToken,
    });
    expect(ownAttempt.status).toBe(403);

    const supported = await callJson<{ complaint: Complaint }>("POST", `/api/complaints/${id}/support`, {
      cookie: bystander.cookie,
      csrfToken: bystander.csrfToken,
    });
    expect(supported.body.complaint.supportCount).toBe(1);
    expect(supported.body.complaint.iSupport).toBe(true);

    const removed = await callJson<{ complaint: Complaint }>("POST", `/api/complaints/${id}/support`, {
      cookie: bystander.cookie,
      csrfToken: bystander.csrfToken,
    });
    expect(removed.body.complaint.supportCount).toBe(0);
  });
});

describe("complaint status workflow", () => {
  test("a student cannot change a status, an admin can", async () => {
    const created = await raiseComplaint(complainer, { title: "Lab computers will not boot" });
    const id = created.body.complaint.id;

    const studentAttempt = await callJson("PATCH", `/api/complaints/${id}/status`, {
      cookie: complainer.cookie,
      csrfToken: complainer.csrfToken,
      body: { status: "resolved", resolutionNote: "I decided this is fine now" },
    });
    expect(studentAttempt.status).toBe(403);

    const moved = await callJson<{ complaint: Complaint }>("PATCH", `/api/complaints/${id}/status`, {
      cookie: admin.cookie,
      csrfToken: admin.csrfToken,
      body: { status: "in_progress", resolutionNote: "Raised with the IT department" },
    });
    expect(moved.status).toBe(200);
    expect(moved.body.complaint.status).toBe("in_progress");
  });

  test("closing a complaint without a note is refused", async () => {
    const created = await raiseComplaint(complainer, { title: "Broken bench in room 204" });
    const result = await callJson<{ error: { field: string } }>(
      "PATCH",
      `/api/complaints/${created.body.complaint.id}/status`,
      { cookie: admin.cookie, csrfToken: admin.csrfToken, body: { status: "resolved", resolutionNote: "" } },
    );
    expect(result.status).toBe(422);
    expect(result.body.error.field).toBe("resolutionNote");
  });

  test("resolving records who closed it and what was done", async () => {
    const created = await raiseComplaint(complainer, { title: "Water cooler leaking near canteen" });
    const resolved = await callJson<{ complaint: Complaint }>(
      "PATCH",
      `/api/complaints/${created.body.complaint.id}/status`,
      {
        cookie: admin.cookie,
        csrfToken: admin.csrfToken,
        body: { status: "resolved", resolutionNote: "Plumber replaced the valve on 20 September." },
      },
    );
    expect(resolved.body.complaint.status).toBe("resolved");
    expect(resolved.body.complaint.resolvedByName).toBe("Campus Admin");
    expect(resolved.body.complaint.resolutionNote).toContain("valve");
  });

  test("the author may withdraw while open, but not after work starts", async () => {
    const withdrawable = await raiseComplaint(complainer, { title: "Fan not working in room 108" });
    const deleted = await call("DELETE", `/api/complaints/${withdrawable.body.complaint.id}`, {
      cookie: complainer.cookie,
      csrfToken: complainer.csrfToken,
    });
    expect(deleted.status).toBe(200);

    const started = await raiseComplaint(complainer, { title: "Projector bulb gone in room 301" });
    await callJson("PATCH", `/api/complaints/${started.body.complaint.id}/status`, {
      cookie: admin.cookie,
      csrfToken: admin.csrfToken,
      body: { status: "in_progress", resolutionNote: "Ordered a replacement bulb" },
    });
    const tooLate = await call("DELETE", `/api/complaints/${started.body.complaint.id}`, {
      cookie: complainer.cookie,
      csrfToken: complainer.csrfToken,
    });
    expect(tooLate.status).toBe(403);

    const anotherStudent = await call("DELETE", `/api/complaints/${started.body.complaint.id}`, {
      cookie: bystander.cookie,
      csrfToken: bystander.csrfToken,
    });
    expect(anotherStudent.status).toBe(403);
  });
});

describe("notices", () => {
  test("only an admin posts a notice, and pinned notices come first", async () => {
    const studentAttempt = await callJson("POST", "/api/notices", {
      cookie: complainer.cookie,
      csrfToken: complainer.csrfToken,
      body: { title: "Fake notice from a student", body: "This should never be accepted." },
    });
    expect(studentAttempt.status).toBe(403);

    const plain = await callJson<{ notice: Notice }>("POST", "/api/notices", {
      cookie: admin.cookie,
      csrfToken: admin.csrfToken,
      body: { title: "Mess committee meeting on Friday", body: "Room 204 at 4 pm.", isPinned: false },
    });
    const pinned = await callJson<{ notice: Notice }>("POST", "/api/notices", {
      cookie: admin.cookie,
      csrfToken: admin.csrfToken,
      body: { title: "Sunday special menu poll is open", body: "Vote by Friday night.", isPinned: true },
    });
    expect(plain.status).toBe(201);
    expect(pinned.status).toBe(201);

    const listed = await callJson<{ notices: Notice[] }>("GET", "/api/notices", { cookie: complainer.cookie });
    expect(listed.body.notices[0]?.isPinned).toBe(true);
    expect(listed.body.notices[0]?.authorName).toBe("Campus Admin");

    const edited = await callJson<{ notice: Notice }>("PATCH", `/api/notices/${plain.body.notice.id}`, {
      cookie: admin.cookie,
      csrfToken: admin.csrfToken,
      body: { title: "Mess committee meeting moved to Saturday", body: "Room 204 at 11 am.", isPinned: false },
    });
    expect(edited.body.notice.title).toContain("Saturday");

    const removed = await call("DELETE", `/api/notices/${plain.body.notice.id}`, {
      cookie: admin.cookie,
      csrfToken: admin.csrfToken,
    });
    expect(removed.status).toBe(200);
  });
});

describe("roster and audit", () => {
  test("the admin roster lists students and records moderation in the audit log", async () => {
    const { status, body } = await callJson<{
      students: { email: string; role: string }[];
      audit: { action: string }[];
    }>("GET", "/api/admin/roster", { cookie: admin.cookie });
    expect(status).toBe(200);
    expect(body.students.some((student) => student.email === "complaint.raiser@poornima.org")).toBe(true);
    expect(body.audit.some((entry) => entry.action.startsWith("complaint."))).toBe(true);
  });

  test("an admin cannot change their own role", async () => {
    const roster = await callJson<{ students: { id: number; email: string }[] }>("GET", "/api/admin/roster", {
      cookie: admin.cookie,
    });
    const self = roster.body.students.find((student) => student.email === "admin@poornima.org");
    const result = await callJson("PATCH", `/api/admin/users/${self?.id}/role`, {
      cookie: admin.cookie,
      csrfToken: admin.csrfToken,
      body: { role: "student" },
    });
    expect(result.status).toBe(403);
  });

  test("deactivating a student ends their session immediately", async () => {
    const victim = await registerStudentSession("deactivate.me@poornima.org", "Temporary Student");
    const roster = await callJson<{ students: { id: number; email: string }[] }>("GET", "/api/admin/roster", {
      cookie: admin.cookie,
    });
    const target = roster.body.students.find((student) => student.email === "deactivate.me@poornima.org");

    const before = await callJson("GET", "/api/auth/me", { cookie: victim.cookie });
    expect(before.status).toBe(200);

    const deactivated = await callJson("PATCH", `/api/admin/users/${target?.id}/active`, {
      cookie: admin.cookie,
      csrfToken: admin.csrfToken,
      body: { isActive: false },
    });
    expect(deactivated.status).toBe(200);

    const after = await callJson("GET", "/api/auth/me", { cookie: victim.cookie });
    expect(after.status).toBe(401);

    const loginAttempt = await callJson("POST", "/api/auth/login", {
      body: { email: "deactivate.me@poornima.org", password: STRONG_PASSWORD },
    });
    expect(loginAttempt.status).toBe(403);
  });
});

describe("dashboard", () => {
  test("the overview reports counts, category scores and a seven day mess trend", async () => {
    const { status, body } = await callJson<{
      studentCount: number;
      openComplaintCount: number;
      resolvedComplaintCount: number;
      categoryScores: { slug: string; reviewCount: number; openComplaints: number }[];
      messTrend: { date: string }[];
      starSpread: { stars: number; count: number }[];
      recentActivity: { kind: string; title: string }[];
    }>("GET", "/api/stats/overview", { cookie: complainer.cookie });

    expect(status).toBe(200);
    expect(body.studentCount).toBeGreaterThan(0);
    expect(body.resolvedComplaintCount).toBe(1);
    expect(body.openComplaintCount).toBeGreaterThan(0);
    expect(body.categoryScores).toHaveLength(14);
    expect(body.messTrend).toHaveLength(7);
    expect(body.starSpread).toHaveLength(5);
    expect(body.recentActivity.some((item) => item.kind === "complaint")).toBe(true);
    const washrooms = body.categoryScores.find((score) => score.slug === "washrooms");
    expect(washrooms?.openComplaints).toBeGreaterThan(0);
  });

  test("signing in as a student never exposes the join code", async () => {
    const asStudent = await callJson<{ joinCodeHint: string | null }>("GET", "/api/auth/me", {
      cookie: complainer.cookie,
    });
    const asAdmin = await callJson<{ joinCodeHint: string | null }>("GET", "/api/auth/me", {
      cookie: admin.cookie,
    });
    expect(asStudent.body.joinCodeHint).toBeNull();
    expect(asAdmin.body.joinCodeHint).toBe("PCE-CAMPUS-2026");
  });

  test("a deactivated student cannot be reactivated by another student", async () => {
    const session = await loginSession("complaint.other@poornima.org");
    const result = await callJson("PATCH", "/api/admin/users/2/active", {
      cookie: session.cookie,
      csrfToken: session.csrfToken,
      body: { isActive: true },
    });
    expect(result.status).toBe(403);
  });
});
