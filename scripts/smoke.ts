/**
 * End-to-end check over real HTTP.
 *
 * Starts the actual server as a separate process on its own port with its own throwaway database, drives
 * every feature through fetch the way a browser would, then stops the server and deletes the database.
 * This is the check that proves the site runs, as distinct from the unit and integration suites which
 * call the request handler in process.
 *
 * Run with: bun run scripts/smoke.ts
 */

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const DATABASE_PATH = "data/smoke-check.sqlite";
const JOIN_CODE = "SMOKE-CHECK-CODE";
const ADMIN_PASSWORD = "smoke-admin-password-2026";
const STUDENT_PASSWORD = "smoke-student-password-2026";
const PROJECT_ROOT = join(import.meta.dir, "..");

/**
 * Set from the spawned server's own startup line.
 *
 * An earlier version hardcoded a port. When a stray server happened to be listening on it, this script
 * talked to that stranger and reported false failures. Asking the operating system for a free port and
 * reading the port back out of our own child's output removes the whole class of problem.
 */
let BASE = "";

type Check = { name: string; passed: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, passed: boolean, detail = ""): void {
  checks.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

function expectEqual(name: string, actual: unknown, expected: unknown): void {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  record(name, passed, passed ? "" : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function expectTrue(name: string, condition: boolean, detail = ""): void {
  record(name, condition, condition ? "" : detail);
}

type Session = { cookie: string; csrf: string };

async function callApi(
  method: string,
  path: string,
  options: { body?: unknown; session?: Session } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.session) {
    headers.cookie = options.session.cookie;
    headers["x-csrf-token"] = options.session.csrf;
  }
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
  const text = await response.text();
  let body: any = {};
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return { status: response.status, body, headers: response.headers };
}

function sessionFrom(headers: Headers, csrf: string): Session {
  const cookie = (headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return { cookie, csrf };
}

/**
 * Reads the spawned server's stdout until it announces its URL, and returns that URL.
 *
 * The server prints "  Open:      http://127.0.0.1:PORT" once it is listening, so this both discovers the
 * port and proves the child is up, with no polling of a guessed address.
 */
async function readServerUrl(stdout: ReadableStream<Uint8Array>, timeoutMs = 20000): Promise<string | null> {
  const decoder = new TextDecoder();
  const reader = stdout.getReader();
  const deadline = Date.now() + timeoutMs;
  let buffered = "";
  try {
    while (Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        Bun.sleep(deadline - Date.now()).then(() => ({ done: true, value: undefined }) as const),
      ]);
      if (chunk.done) break;
      buffered += decoder.decode(chunk.value, { stream: true });
      const found = buffered.match(/Open:\s+(http:\/\/[\d.]+:\d+)/);
      if (found) return found[1] as string;
    }
  } finally {
    reader.releaseLock();
  }
  console.log(`Server output so far:\n${buffered}`);
  return null;
}

async function waitForSignInPage(attempts = 40): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/login`, { redirect: "manual" });
      if (response.status === 200) return true;
    } catch {
      // Listener is not accepting connections yet.
    }
    await Bun.sleep(100);
  }
  return false;
}

function removeSmokeDatabase(): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const file = join(PROJECT_ROOT, `${DATABASE_PATH}${suffix}`);
    if (existsSync(file)) rmSync(file, { force: true });
  }
}

async function runAuthChecks(): Promise<{ student: Session; second: Session; admin: Session }> {
  const blocked = await callApi("POST", "/api/auth/register", {
    body: { name: "Outsider", email: "outsider@gmail.com", password: STUDENT_PASSWORD, joinCode: JOIN_CODE },
  });
  expectEqual("registration refuses a non-college email", blocked.status, 422);

  const wrongCode = await callApi("POST", "/api/auth/register", {
    body: { name: "No Code", email: "nocode@poornima.org", password: STUDENT_PASSWORD, joinCode: "WRONG" },
  });
  expectEqual("registration refuses a wrong join code", wrongCode.status, 403);

  const registered = await callApi("POST", "/api/auth/register", {
    body: {
      name: "Smoke Student",
      email: "smoke.student@poornima.org",
      password: STUDENT_PASSWORD,
      joinCode: JOIN_CODE,
      branch: "Computer Science",
      studyYear: 3,
      isHostelResident: true,
    },
  });
  expectEqual("a student can register", registered.status, 201);
  const student = sessionFrom(registered.headers, registered.body.csrfToken);
  expectTrue("registration sets an HttpOnly cookie", (registered.headers.get("set-cookie") ?? "").includes("HttpOnly"));

  const secondRegistered = await callApi("POST", "/api/auth/register", {
    body: {
      name: "Second Student",
      email: "smoke.second@poornima.org",
      password: STUDENT_PASSWORD,
      joinCode: JOIN_CODE,
      isHostelResident: false,
    },
  });
  const second = sessionFrom(secondRegistered.headers, secondRegistered.body.csrfToken);

  const adminLogin = await callApi("POST", "/api/auth/login", {
    body: { email: "admin@poornima.org", password: ADMIN_PASSWORD },
  });
  expectEqual("the admin can sign in", adminLogin.status, 200);
  const admin = sessionFrom(adminLogin.headers, adminLogin.body.csrfToken);
  expectEqual("the admin has the admin role", adminLogin.body.user.role, "admin");

  const noCookie = await callApi("GET", "/api/auth/me");
  expectEqual("an endpoint refuses a request with no session", noCookie.status, 401);

  const noCsrf = await fetch(`${BASE}/api/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: student.cookie },
    body: JSON.stringify({ categoryId: 1, title: "No token", body: "This should be refused.", stars: 3 }),
  });
  expectEqual("a write with no CSRF token is refused", noCsrf.status, 403);

  return { student, second, admin };
}

async function runMessChecks(student: Session, second: Session, admin: Session): Promise<void> {
  const today = (await callApi("GET", "/api/mess/day", { session: student })).body.date;

  const week = await callApi("GET", "/api/mess/week", { session: student });
  expectEqual("the weekly menu has seven days", week.body.days?.length, 7);

  const rated = await callApi("POST", "/api/mess/ratings", {
    session: student,
    body: {
      servedOn: today,
      meal: "lunch",
      stars: 2,
      taste: 2,
      hygiene: 3,
      quantity: 4,
      comment: "Dal was watery.",
      isAnonymous: false,
    },
  });
  expectEqual("a student can rate a meal", rated.status, 201);

  await callApi("POST", "/api/mess/ratings", {
    session: student,
    body: { servedOn: today, meal: "lunch", stars: 4, comment: "Second serving was better.", isAnonymous: false },
  });
  const afterUpdate = await callApi("GET", `/api/mess/day?date=${today}`, { session: student });
  const lunch = afterUpdate.body.meals.find((meal: any) => meal.meal === "lunch");
  expectEqual("rating the same meal twice updates instead of duplicating", lunch.aggregate.ratingCount, 1);
  expectEqual("the updated stars are stored", lunch.aggregate.averageStars, 4);

  const future = await callApi("POST", "/api/mess/ratings", {
    session: student,
    body: { servedOn: "2099-01-01", meal: "dinner", stars: 5 },
  });
  expectEqual("a future meal cannot be rated", future.status, 422);

  await callApi("POST", "/api/mess/ratings", {
    session: second,
    body: { servedOn: today, meal: "breakfast", stars: 1, comment: "Poha was cold.", isAnonymous: true },
  });
  const listed = await callApi("GET", `/api/mess/ratings?date=${today}&meal=breakfast`, { session: student });
  const anonymous = listed.body.ratings.find((rating: any) => rating.comment === "Poha was cold.");
  expectEqual("an anonymous rating hides the author", anonymous?.authorName, "Anonymous student");

  const studentMenu = await callApi("PUT", "/api/mess/menu", {
    session: student,
    body: { weekday: 1, meal: "lunch", items: "Student tried to edit the menu" },
  });
  expectEqual("a student cannot edit the menu", studentMenu.status, 403);

  const adminMenu = await callApi("PUT", "/api/mess/menu", {
    session: admin,
    body: { weekday: 1, meal: "lunch", items: "Kadhi pakora, rice, roti, salad" },
  });
  expectEqual("an admin can edit the menu", adminMenu.status, 200);

  const trend = await callApi("GET", "/api/mess/trend?days=7", { session: student });
  expectEqual("the trend returns seven points", trend.body.points?.length, 7);
}

async function runReviewChecks(student: Session, second: Session, admin: Session): Promise<number> {
  const categories = await callApi("GET", "/api/categories", { session: student });
  const hostel = categories.body.categories.find((category: any) => category.slug === "hostel");
  expectTrue("categories are seeded", categories.body.categories.length >= 14, `${categories.body.categories.length} found`);

  const created = await callApi("POST", "/api/reviews", {
    session: student,
    body: {
      categoryId: hostel.id,
      subject: "Block C",
      title: "Water stops after 9 pm",
      body: "Taps are dry every night on the third floor and refill only in the morning.",
      stars: 2,
      isAnonymous: false,
    },
  });
  expectEqual("a student can post a review", created.status, 201);
  const reviewId = created.body.review.id;

  const edited = await callApi("PATCH", `/api/reviews/${reviewId}`, {
    session: second,
    body: { categoryId: hostel.id, title: "Hijacked title", body: "Another student editing this.", stars: 5 },
  });
  expectEqual("another student cannot edit someone else's review", edited.status, 403);

  const ownEdit = await callApi("PATCH", `/api/reviews/${reviewId}`, {
    session: student,
    body: {
      categoryId: hostel.id,
      subject: "Block C",
      title: "Water stops after 9 pm most nights",
      body: "Taps are dry every night on the third floor and refill only in the morning.",
      stars: 2,
      isAnonymous: false,
    },
  });
  expectEqual("the author can edit their own review", ownEdit.status, 200);

  const ownVote = await callApi("POST", `/api/reviews/${reviewId}/helpful`, { session: student });
  expectEqual("a student cannot mark their own review helpful", ownVote.status, 403);

  const vote = await callApi("POST", `/api/reviews/${reviewId}/helpful`, { session: second });
  expectEqual("another student can mark it helpful", vote.body.helpfulCount, 1);
  const unvote = await callApi("POST", `/api/reviews/${reviewId}/helpful`, { session: second });
  expectEqual("marking helpful again takes the vote back", unvote.body.helpfulCount, 0);

  const reply = await callApi("POST", `/api/reviews/${reviewId}/comments`, {
    session: second,
    body: { body: "Same on my floor since last week.", isAnonymous: false },
  });
  expectEqual("a student can reply to a review", reply.status, 201);

  const report = await callApi("POST", `/api/reviews/${reviewId}/report`, {
    session: second,
    body: { reason: "Checking the moderation queue works" },
  });
  expectEqual("a review can be reported", report.status, 201);
  const duplicate = await callApi("POST", `/api/reviews/${reviewId}/report`, {
    session: second,
    body: { reason: "Reporting twice" },
  });
  expectEqual("the same student cannot report twice", duplicate.status, 409);

  const queue = await callApi("GET", "/api/admin/reports", { session: admin });
  expectTrue("the admin sees the report in the queue", queue.body.reports?.some((entry: any) => entry.id === reviewId));

  const studentQueue = await callApi("GET", "/api/admin/reports", { session: student });
  expectEqual("a student cannot read the report queue", studentQueue.status, 403);

  const hidden = await callApi("POST", `/api/admin/reviews/${reviewId}/hide`, {
    session: admin,
    body: { reason: "Checking moderation, will restore" },
  });
  expectEqual("an admin can hide a review", hidden.body.review?.status, "hidden");

  const asOther = await callApi("GET", `/api/reviews/${reviewId}`, { session: second });
  expectEqual("a hidden review is not readable by another student", asOther.status, 404);

  const asAuthor = await callApi("GET", `/api/reviews/${reviewId}`, { session: student });
  expectEqual("the author still sees why it was hidden", asAuthor.body.review?.hiddenReason, "Checking moderation, will restore");

  const restored = await callApi("POST", `/api/admin/reviews/${reviewId}/restore`, { session: admin });
  expectEqual("an admin can restore a review", restored.body.review?.status, "visible");

  const searched = await callApi("GET", "/api/reviews?q=water&sort=recent", { session: second });
  expectTrue("search finds the review", searched.body.total >= 1, `total ${searched.body.total}`);

  const injected = await callApi("POST", "/api/reviews", {
    session: second,
    body: {
      categoryId: hostel.id,
      title: "Script tag test <script>alert(1)</script>",
      body: "Body with <script>alert('xss')</script> and ' OR 1=1 -- inside it.",
      stars: 3,
      isAnonymous: false,
    },
  });
  expectEqual("a review containing markup is stored as text", injected.status, 201);
  expectEqual(
    "the markup is returned verbatim rather than executed or stripped",
    injected.body.review.title,
    "Script tag test <script>alert(1)</script>",
  );
  const stillThere = await callApi("GET", "/api/reviews?pageSize=50", { session: second });
  expectTrue("an injection attempt did not damage the table", stillThere.body.total >= 2, `total ${stillThere.body.total}`);

  return reviewId;
}

async function runComplaintAndNoticeChecks(student: Session, second: Session, admin: Session): Promise<void> {
  const categories = await callApi("GET", "/api/categories", { session: student });
  const washrooms = categories.body.categories.find((category: any) => category.slug === "washrooms");

  const raised = await callApi("POST", "/api/complaints", {
    session: student,
    body: {
      categoryId: washrooms.id,
      title: "No water in block B washroom",
      body: "Taps dry from the afternoon onwards every day this week.",
      location: "Block B, second floor",
      severity: "high",
      isAnonymous: false,
    },
  });
  expectEqual("a student can raise a complaint", raised.status, 201);
  const complaintId = raised.body.complaint.id;
  expectEqual("a new complaint starts open", raised.body.complaint.status, "open");

  const support = await callApi("POST", `/api/complaints/${complaintId}/support`, { session: second });
  expectEqual("another student can add support", support.body.complaint?.supportCount, 1);

  const ownSupport = await callApi("POST", `/api/complaints/${complaintId}/support`, { session: student });
  expectEqual("the author cannot support their own complaint", ownSupport.status, 403);

  const studentStatus = await callApi("PATCH", `/api/complaints/${complaintId}/status`, {
    session: student,
    body: { status: "resolved", resolutionNote: "I am marking my own complaint resolved" },
  });
  expectEqual("a student cannot change a complaint status", studentStatus.status, 403);

  const noNote = await callApi("PATCH", `/api/complaints/${complaintId}/status`, {
    session: admin,
    body: { status: "resolved", resolutionNote: "" },
  });
  expectEqual("resolving with no note is refused", noNote.status, 422);

  const resolved = await callApi("PATCH", `/api/complaints/${complaintId}/status`, {
    session: admin,
    body: { status: "resolved", resolutionNote: "Plumber fixed the supply line on 22 September." },
  });
  expectEqual("an admin can resolve with a note", resolved.body.complaint?.status, "resolved");
  expectEqual("the resolver is recorded", resolved.body.complaint?.resolvedByName, "Campus Admin");

  const lateWithdraw = await callApi("DELETE", `/api/complaints/${complaintId}`, { session: student });
  expectEqual("the author cannot withdraw a complaint after it is closed", lateWithdraw.status, 403);

  const studentNotice = await callApi("POST", "/api/notices", {
    session: student,
    body: { title: "Student posting a notice", body: "This should be refused." },
  });
  expectEqual("a student cannot post a notice", studentNotice.status, 403);

  const notice = await callApi("POST", "/api/notices", {
    session: admin,
    body: { title: "Mess committee meeting on Friday", body: "Room 204 at 4 pm.", isPinned: true },
  });
  expectEqual("an admin can post a notice", notice.status, 201);

  const notices = await callApi("GET", "/api/notices", { session: student });
  expectEqual("a pinned notice is listed first", notices.body.notices?.[0]?.isPinned, true);

  const updated = await callApi("PATCH", `/api/notices/${notice.body.notice.id}`, {
    session: admin,
    body: { title: "Mess committee meeting moved to Saturday", body: "Room 204 at 11 am.", isPinned: true },
  });
  expectEqual("an admin can edit a notice", updated.status, 200);

  const deleted = await callApi("DELETE", `/api/notices/${notice.body.notice.id}`, { session: admin });
  expectEqual("an admin can delete a notice", deleted.status, 200);
}

async function runDashboardAndSessionChecks(student: Session, admin: Session): Promise<void> {
  const overview = await callApi("GET", "/api/stats/overview", { session: student });
  expectEqual("the dashboard overview loads", overview.status, 200);
  expectTrue("the overview counts students", overview.body.studentCount >= 3, `count ${overview.body.studentCount}`);
  expectEqual("the overview has a score for every category", overview.body.categoryScores?.length, 14);
  expectEqual("the overview has a seven day trend", overview.body.messTrend?.length, 7);
  expectEqual("the overview has five star buckets", overview.body.starSpread?.length, 5);

  const roster = await callApi("GET", "/api/admin/roster", { session: admin });
  expectTrue("the roster lists the students", roster.body.students?.length >= 3);
  expectTrue("the audit log recorded moderation", roster.body.audit?.length >= 1);

  const self = roster.body.students.find((user: any) => user.email === "admin@poornima.org");
  const selfDemote = await callApi("PATCH", `/api/admin/users/${self.id}/role`, {
    session: admin,
    body: { role: "student" },
  });
  expectEqual("an admin cannot demote themselves", selfDemote.status, 403);
  const stillAdmin = await callApi("GET", "/api/auth/me", { session: admin });
  expectEqual("the admin still holds the admin role after that attempt", stillAdmin.body.user?.role, "admin");

  const changed = await callApi("POST", "/api/auth/password", {
    session: student,
    body: { currentPassword: STUDENT_PASSWORD, newPassword: "a-completely-different-phrase-99" },
  });
  expectEqual("a student can change their password", changed.status, 200);
  const oldSession = await callApi("GET", "/api/auth/me", { session: student });
  expectEqual("the old session is dead after a password change", oldSession.status, 401);
  const staleLogin = await callApi("POST", "/api/auth/login", {
    body: { email: "smoke.student@poornima.org", password: STUDENT_PASSWORD },
  });
  expectEqual("the old password no longer works", staleLogin.status, 401);
  const freshLogin = await callApi("POST", "/api/auth/login", {
    body: { email: "smoke.student@poornima.org", password: "a-completely-different-phrase-99" },
  });
  expectEqual("the new password works", freshLogin.status, 200);

  const signedOut = sessionFrom(freshLogin.headers, freshLogin.body.csrfToken);
  const logout = await callApi("POST", "/api/auth/logout", { session: signedOut, body: {} });
  expectEqual("signing out succeeds", logout.status, 200);
  const afterLogout = await callApi("GET", "/api/auth/me", { session: signedOut });
  expectEqual("the session is gone after signing out", afterLogout.status, 401);
}

async function runPageChecks(admin: Session): Promise<void> {
  for (const path of ["/", "/mess", "/reviews", "/complaints", "/notices", "/profile", "/admin"]) {
    const response = await fetch(`${BASE}${path}`, { redirect: "manual" });
    expectEqual(`a signed-out browser is redirected from ${path}`, response.status, 302);
  }
  const page = await fetch(`${BASE}/admin`, { headers: { cookie: admin.cookie }, redirect: "manual" });
  expectEqual("the admin page is served to an admin", page.status, 200);

  const css = await fetch(`${BASE}/css/app.css`);
  expectEqual("the stylesheet is served", css.status, 200);
  const script = await fetch(`${BASE}/js/dashboard.js`);
  expectEqual("a page script is served", script.status, 200);
  const traversal = await fetch(`${BASE}/css/../../src/config.ts`, { redirect: "manual" });
  expectTrue("a traversal request does not return source", traversal.status !== 200, `status ${traversal.status}`);
  const policy = (await fetch(`${BASE}/login`)).headers.get("content-security-policy") ?? "";
  expectTrue("a strict content policy is sent", policy.includes("default-src 'self'") && !policy.includes("unsafe-inline"));
}

async function main(): Promise<void> {
  removeSmokeDatabase();
  // process.execPath is the Bun binary running this script. Spawning "bun" by name would need it on
  // PATH, which it is not on the machine this was built on. PORT=0 lets the OS pick a free port.
  const server = Bun.spawn([process.execPath, "run", "src/server.ts"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: "0",
      DATABASE_PATH,
      JOIN_CODE,
      ADMIN_PASSWORD,
      HOST: "127.0.0.1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    const announced = await readServerUrl(server.stdout as ReadableStream<Uint8Array>);
    expectTrue("the server starts and announces its address", announced !== null);
    if (!announced) return;
    BASE = announced;
    console.log(`Driving checks against ${BASE}`);

    const ready = await waitForSignInPage();
    expectTrue("the server serves the sign-in page", ready);
    if (!ready) return;

    const sessions = await runAuthChecks();
    await runMessChecks(sessions.student, sessions.second, sessions.admin);
    await runReviewChecks(sessions.student, sessions.second, sessions.admin);
    await runComplaintAndNoticeChecks(sessions.student, sessions.second, sessions.admin);
    await runDashboardAndSessionChecks(sessions.student, sessions.admin);
    await runPageChecks(sessions.admin);
  } finally {
    server.kill();
    await server.exited;
    removeSmokeDatabase();
  }

  const failed = checks.filter((check) => !check.passed);
  console.log("");
  console.log(`${checks.length - failed.length} of ${checks.length} checks passed.`);
  if (failed.length > 0) {
    console.log("Failed checks:");
    for (const check of failed) console.log(`  - ${check.name}: ${check.detail}`);
    process.exitCode = 1;
  }
}

await main();
