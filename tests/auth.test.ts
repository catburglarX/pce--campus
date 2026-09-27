/**
 * Authentication and session tests.
 *
 * These cover the paths auth-implement calls the most attacked: the registration gate, login throttling,
 * what happens to old sessions after a password change, and whether a write without a CSRF token is
 * refused.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  call,
  callJson,
  JOIN_CODE,
  loginSession,
  readSessionCookie,
  registerStudentSession,
  startTestDatabase,
  stopTestDatabase,
  STRONG_PASSWORD,
} from "./helpers";
import { resetAllLimits } from "../src/ratelimit";

beforeAll(async () => {
  await startTestDatabase();
});

afterAll(async () => {
  await stopTestDatabase();
});

describe("registration gate", () => {
  test("a correct join code and college email creates an account", async () => {
    const session = await registerStudentSession("rahul.sharma@poornima.org", "Rahul Sharma");
    expect(session.user.email).toBe("rahul.sharma@poornima.org");
    expect(session.user.role).toBe("student");
    expect(session.csrfToken.length).toBeGreaterThan(30);
  });

  test("a wrong join code is refused", async () => {
    const { status, body } = await callJson<{ error: { message: string } }>("POST", "/api/auth/register", {
      body: {
        name: "Outsider",
        email: "outsider@poornima.org",
        password: STRONG_PASSWORD,
        joinCode: "GUESSED-CODE",
        isHostelResident: false,
      },
    });
    expect(status).toBe(403);
    expect(body.error.message).toContain("join code");
  });

  test("an email outside the allowed domains is refused", async () => {
    const { status, body } = await callJson<{ error: { field: string } }>("POST", "/api/auth/register", {
      body: {
        name: "Random Person",
        email: "someone@gmail.com",
        password: STRONG_PASSWORD,
        joinCode: JOIN_CODE,
        isHostelResident: false,
      },
    });
    expect(status).toBe(422);
    expect(body.error.field).toBe("email");
  });

  test("a weak password is refused before an account exists", async () => {
    const { status, body } = await callJson<{ error: { field: string; message: string } }>(
      "POST",
      "/api/auth/register",
      {
        body: {
          name: "Weak Password",
          email: "weak@poornima.org",
          password: "password123",
          joinCode: JOIN_CODE,
          isHostelResident: false,
        },
      },
    );
    expect(status).toBe(422);
    expect(body.error.field).toBe("password");
    const retry = await callJson("POST", "/api/auth/login", {
      body: { email: "weak@poornima.org", password: "password123" },
    });
    expect(retry.status).toBe(401);
  });

  test("the same email cannot register twice", async () => {
    await registerStudentSession("duplicate@poornima.org");
    const { status } = await callJson("POST", "/api/auth/register", {
      body: {
        name: "Duplicate",
        email: "duplicate@poornima.org",
        password: STRONG_PASSWORD,
        joinCode: JOIN_CODE,
        isHostelResident: false,
      },
    });
    expect(status).toBe(409);
  });
});

describe("login", () => {
  test("a wrong password does not say whether the email exists", async () => {
    await registerStudentSession("priya.meena@poornima.org", "Priya Meena");
    const wrongPassword = await callJson<{ error: { message: string } }>("POST", "/api/auth/login", {
      body: { email: "priya.meena@poornima.org", password: "definitely-not-the-password" },
    });
    const unknownEmail = await callJson<{ error: { message: string } }>("POST", "/api/auth/login", {
      body: { email: "nobody.here@poornima.org", password: "definitely-not-the-password" },
    });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
    resetAllLimits();
  });

  test("repeated failures are throttled, and the throttle names a wait", async () => {
    const email = "throttle.target@poornima.org";
    await registerStudentSession(email, "Throttle Target");
    let lastStatus = 0;
    let lastBody: { error?: { message: string } } = {};
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const result = await callJson<{ error: { message: string } }>("POST", "/api/auth/login", {
        body: { email, password: "wrong-password-again" },
      });
      lastStatus = result.status;
      lastBody = result.body;
      if (result.status === 429) break;
    }
    expect(lastStatus).toBe(429);
    expect(lastBody.error?.message).toContain("Try again in");
    resetAllLimits();
    const recovered = await loginSession(email);
    expect(recovered.cookie.length).toBeGreaterThan(20);
  });
});

describe("sessions", () => {
  test("a protected endpoint refuses a request with no cookie", async () => {
    const { status } = await callJson("GET", "/api/auth/me");
    expect(status).toBe(401);
  });

  test("a tampered cookie is not accepted", async () => {
    const session = await registerStudentSession("cookie.tamper@poornima.org");
    const tampered = `${session.cookie.slice(0, -4)}dead`;
    const { status } = await callJson("GET", "/api/auth/me", { cookie: tampered });
    expect(status).toBe(401);
  });

  test("signing out invalidates the cookie immediately", async () => {
    const session = await registerStudentSession("signout@poornima.org");
    const out = await call("POST", "/api/auth/logout", {
      cookie: session.cookie,
      csrfToken: session.csrfToken,
    });
    expect(out.status).toBe(200);
    const after = await callJson("GET", "/api/auth/me", { cookie: session.cookie });
    expect(after.status).toBe(401);
  });

  test("changing the password invalidates every older session", async () => {
    const email = "rotate.password@poornima.org";
    const first = await registerStudentSession(email, "Rotate Password");
    const second = await loginSession(email);
    const changed = await call("POST", "/api/auth/password", {
      cookie: second.cookie,
      csrfToken: second.csrfToken,
      body: { currentPassword: STRONG_PASSWORD, newPassword: "new-mess-menu-please-77" },
    });
    expect(changed.status).toBe(200);
    const replacement = readSessionCookie(changed);

    const oldSessionCheck = await callJson("GET", "/api/auth/me", { cookie: first.cookie });
    const usedSessionCheck = await callJson("GET", "/api/auth/me", { cookie: second.cookie });
    const newSessionCheck = await callJson("GET", "/api/auth/me", { cookie: replacement });
    expect(oldSessionCheck.status).toBe(401);
    expect(usedSessionCheck.status).toBe(401);
    expect(newSessionCheck.status).toBe(200);

    const oldPasswordLogin = await callJson("POST", "/api/auth/login", {
      body: { email, password: STRONG_PASSWORD },
    });
    expect(oldPasswordLogin.status).toBe(401);
    resetAllLimits();
  });
});

describe("CSRF", () => {
  test("a write with no CSRF header is refused", async () => {
    const session = await registerStudentSession("csrf.missing@poornima.org");
    const { status, body } = await callJson<{ error: { message: string } }>("POST", "/api/reviews", {
      cookie: session.cookie,
      body: { categoryId: 1, title: "Nice hostel", body: "The rooms are clean enough.", stars: 4 },
    });
    expect(status).toBe(403);
    expect(body.error.message).toContain("CSRF");
  });

  test("a write with another session's CSRF token is refused", async () => {
    const owner = await registerStudentSession("csrf.owner@poornima.org");
    const other = await registerStudentSession("csrf.other@poornima.org");
    const { status } = await callJson("POST", "/api/reviews", {
      cookie: owner.cookie,
      csrfToken: other.csrfToken,
      body: { categoryId: 1, title: "Library review", body: "Quiet in the morning only.", stars: 3 },
    });
    expect(status).toBe(403);
  });
});
