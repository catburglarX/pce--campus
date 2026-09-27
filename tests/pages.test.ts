/**
 * Page and asset tests.
 *
 * These check what a browser meets first: whether a signed-out visitor can pull an application page,
 * whether a student can pull the admin page, whether the security headers are present, and whether every
 * script each page loads actually exists on disk.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  adminSession,
  call,
  registerStudentSession,
  startTestDatabase,
  stopTestDatabase,
  type TestSession,
} from "./helpers";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");
const STUDENT_PAGES = ["/", "/mess", "/reviews", "/complaints", "/notices", "/profile"];

let student: TestSession;
let admin: TestSession;

beforeAll(async () => {
  await startTestDatabase();
  student = await registerStudentSession("page.reader@poornima.org", "Page Reader");
  admin = await adminSession();
});

afterAll(async () => {
  await stopTestDatabase();
});

describe("page gating", () => {
  test("a signed-out visitor is redirected from every application page", async () => {
    for (const path of [...STUDENT_PAGES, "/admin"]) {
      const response = await call("GET", path);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toStartWith("/login");
    }
  });

  test("a signed-in student receives every student page as HTML", async () => {
    for (const path of STUDENT_PAGES) {
      const response = await call("GET", path, { cookie: student.cookie });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      const html = await response.text();
      expect(html).toContain("<!doctype html>");
      expect(html).toContain('id="app-header"');
    }
  });

  test("a student is redirected away from the admin page, an admin is not", async () => {
    const asStudent = await call("GET", "/admin", { cookie: student.cookie });
    expect(asStudent.status).toBe(302);
    expect(asStudent.headers.get("location")).toBe("/?denied=admin");

    const asAdmin = await call("GET", "/admin", { cookie: admin.cookie });
    expect(asAdmin.status).toBe(200);
  });

  test("a signed-in student is sent away from sign-in and registration", async () => {
    for (const path of ["/login", "/register"]) {
      const response = await call("GET", path, { cookie: student.cookie });
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/");
    }
  });

  test("sign-in and registration are served to a visitor with no session", async () => {
    for (const path of ["/login", "/register"]) {
      const response = await call("GET", path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("<form");
    }
  });

  test("an unknown page is a 404 and an unknown endpoint is a JSON 404", async () => {
    const page = await call("GET", "/does-not-exist");
    expect(page.status).toBe(404);

    const endpoint = await call("GET", "/api/does-not-exist");
    expect(endpoint.status).toBe(404);
    expect(endpoint.headers.get("content-type")).toContain("application/json");
  });

  test("a known endpoint with the wrong method answers 405", async () => {
    const response = await call("DELETE", "/api/reviews", {
      cookie: student.cookie,
      csrfToken: student.csrfToken,
    });
    expect(response.status).toBe(405);
  });
});

describe("headers", () => {
  test("security headers and a strict policy are set on pages and on the API", async () => {
    for (const response of [
      await call("GET", "/login"),
      await call("GET", "/api/auth/me", { cookie: student.cookie }),
    ]) {
      const policy = response.headers.get("content-security-policy") ?? "";
      expect(policy).toContain("default-src 'self'");
      expect(policy).toContain("frame-ancestors 'none'");
      expect(policy).not.toContain("unsafe-inline");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("referrer-policy")).toBe("same-origin");
    }
  });

  test("the session cookie is HttpOnly and SameSite=Strict", async () => {
    const response = await call("POST", "/api/auth/login", {
      body: { email: "page.reader@poornima.org", password: "mess-roti-is-cold-42" },
    });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
  });

  test("application pages are not cached", async () => {
    const response = await call("GET", "/", { cookie: student.cookie });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("static assets", () => {
  test("the stylesheets and page scripts are served with the right content type", async () => {
    const css = await call("GET", "/css/app.css");
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");

    const script = await call("GET", "/js/dom.js");
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("text/javascript");
  });

  test("a traversal attempt cannot read source outside public", async () => {
    for (const path of [
      "/css/../../src/config.ts",
      "/js/../../package.json",
      "/css/..%2F..%2Fsrc%2Fserver.ts",
    ]) {
      const response = await call("GET", path);
      expect(response.status).toBe(404);
    }
  });

  test("every script and stylesheet referenced by a page exists on disk", () => {
    const pages = readdirSync(PUBLIC_DIR).filter((name) => name.endsWith(".html"));
    expect(pages.length).toBeGreaterThan(5);
    const missing: string[] = [];
    for (const page of pages) {
      const html = readFileSync(join(PUBLIC_DIR, page), "utf8");
      for (const match of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
        const reference = match[1] as string;
        if (reference.startsWith("/css/") || reference.startsWith("/js/") || reference.endsWith(".svg")) {
          if (!existsSync(join(PUBLIC_DIR, reference))) missing.push(`${page} -> ${reference}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test("no page uses an inline style or an inline event handler, which the policy would block", () => {
    const pages = readdirSync(PUBLIC_DIR).filter((name) => name.endsWith(".html"));
    const offenders: string[] = [];
    for (const page of pages) {
      const html = readFileSync(join(PUBLIC_DIR, page), "utf8");
      if (/\sstyle="/.test(html)) offenders.push(`${page}: style attribute`);
      if (/\son(?:click|load|submit|change|input)=/i.test(html)) offenders.push(`${page}: inline handler`);
      if (/<style[\s>]/.test(html)) offenders.push(`${page}: inline style block`);
    }
    expect(offenders).toEqual([]);
  });

  test("no client script writes innerHTML, which would reopen script injection", () => {
    const scripts = readdirSync(join(PUBLIC_DIR, "js")).filter((name) => name.endsWith(".js"));
    const offenders = scripts.filter((name) => {
      const source = readFileSync(join(PUBLIC_DIR, "js", name), "utf8");
      return /\.innerHTML\s*=/.test(source) || /insertAdjacentHTML/.test(source);
    });
    expect(offenders).toEqual([]);
  });
});
