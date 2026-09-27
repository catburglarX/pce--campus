/**
 * Frontend wiring tests.
 *
 * There is no browser in this environment, so the failure mode that worries me most is a page whose
 * script queries an element that the HTML does not contain. That produces a null, then a TypeError, then
 * a blank panel, and no server-side test would notice.
 *
 * These tests follow each page's import graph, collect every element id the code looks up, and check the
 * page actually declares it. They also check the reverse direction loosely, and that no module imports a
 * file that does not exist.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const PUBLIC_DIR = resolve(join(import.meta.dir, "..", "public"));
const JS_DIR = join(PUBLIC_DIR, "js");

function readPage(fileName: string): string {
  return readFileSync(join(PUBLIC_DIR, fileName), "utf8");
}

function listPages(): string[] {
  return readdirSync(PUBLIC_DIR).filter((name) => name.endsWith(".html"));
}

/** The module each page loads, taken from its own script tag rather than a hardcoded list. */
function entryModuleFor(html: string): string | null {
  const match = html.match(/<script[^>]*type="module"[^>]*src="\/js\/([^"]+)"/);
  return match ? (match[1] as string) : null;
}

/** Follows relative imports from an entry module and returns every file in the graph. */
function moduleGraph(entryFile: string): string[] {
  const seen = new Set<string>();
  const queue = [join(JS_DIR, entryFile)];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (seen.has(current) || !existsSync(current)) continue;
    seen.add(current);
    const source = readFileSync(current, "utf8");
    for (const match of source.matchAll(/from\s+"(\.\/[^"]+)"/g)) {
      queue.push(resolve(dirname(current), match[1] as string));
    }
  }
  return [...seen];
}

/** Element ids the code looks up, from querySelector, querySelectorAll and getElementById. */
function queriedIds(source: string): string[] {
  const ids = new Set<string>();
  const patterns = [
    /querySelector(?:All)?\(\s*"#([A-Za-z][\w-]*)/g,
    /querySelector(?:All)?\(\s*'#([A-Za-z][\w-]*)/g,
    /getElementById\(\s*"([A-Za-z][\w-]*)"/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) ids.add(match[1] as string);
  }
  return [...ids];
}

function declaredIds(html: string): Set<string> {
  const ids = new Set<string>();
  for (const match of html.matchAll(/\sid="([^"]+)"/g)) ids.add(match[1] as string);
  return ids;
}

describe("page scripts match their markup", () => {
  test("every page declares a module script that exists on disk", () => {
    const problems: string[] = [];
    for (const page of listPages()) {
      const entry = entryModuleFor(readPage(page));
      if (!entry) {
        problems.push(`${page}: no module script tag`);
        continue;
      }
      if (!existsSync(join(JS_DIR, entry))) problems.push(`${page}: /js/${entry} is missing`);
    }
    expect(problems).toEqual([]);
  });

  test("every element id a page's scripts query is present in that page", () => {
    const problems: string[] = [];
    for (const page of listPages()) {
      const html = readPage(page);
      const entry = entryModuleFor(html);
      if (!entry) continue;
      const present = declaredIds(html);
      for (const modulePath of moduleGraph(entry)) {
        const source = readFileSync(modulePath, "utf8");
        for (const id of queriedIds(source)) {
          if (!present.has(id)) {
            problems.push(`${page} loads js/${entry}, which queries #${id}, absent from the page`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test("no module imports a file that does not exist", () => {
    const problems: string[] = [];
    for (const name of readdirSync(JS_DIR).filter((file) => file.endsWith(".js"))) {
      const source = readFileSync(join(JS_DIR, name), "utf8");
      for (const match of source.matchAll(/from\s+"(\.\/[^"]+)"/g)) {
        const target = resolve(JS_DIR, match[1] as string);
        if (!existsSync(target)) problems.push(`js/${name} imports ${match[1]}, which is missing`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("every module a page loads is reachable from some page, so nothing is orphaned", () => {
    const reachable = new Set<string>();
    for (const page of listPages()) {
      const entry = entryModuleFor(readPage(page));
      if (!entry) continue;
      for (const modulePath of moduleGraph(entry)) reachable.add(modulePath);
    }
    const orphans = readdirSync(JS_DIR)
      .filter((file) => file.endsWith(".js"))
      .map((file) => join(JS_DIR, file))
      .filter((path) => !reachable.has(path))
      .map((path) => path.replace(PUBLIC_DIR, ""));
    expect(orphans).toEqual([]);
  });
});

describe("accessibility structure present in the markup", () => {
  test("each page has one h1, a main landmark and a skip link where it applies", () => {
    const problems: string[] = [];
    for (const page of listPages()) {
      const html = readPage(page);
      const headingCount = [...html.matchAll(/<h1[\s>]/g)].length;
      if (headingCount !== 1) problems.push(`${page}: ${headingCount} h1 elements, expected 1`);
      if (!/<main[\s>]/.test(html)) problems.push(`${page}: no main element`);
      if (!/lang="en"/.test(html)) problems.push(`${page}: html element has no lang`);
      if (!/<title>/.test(html)) problems.push(`${page}: no title`);
      const isAuthPage = page === "login.html" || page === "register.html";
      if (!isAuthPage && !/class="skip-link"/.test(html)) problems.push(`${page}: no skip link`);
    }
    expect(problems).toEqual([]);
  });

  test("every form control has a label bound to its id", () => {
    const problems: string[] = [];
    for (const page of listPages()) {
      const html = readPage(page);
      const labelTargets = new Set([...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1] as string));
      for (const match of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
        const attributes = match[2] as string;
        if (/type="(hidden|submit|reset|button)"/.test(attributes)) continue;
        const idMatch = attributes.match(/\sid="([^"]+)"/);
        if (!idMatch) {
          problems.push(`${page}: a ${match[1]} has no id, so no label can point at it`);
          continue;
        }
        const id = idMatch[1] as string;
        const hasAriaLabel = /aria-label="/.test(attributes);
        if (!labelTargets.has(id) && !hasAriaLabel) {
          problems.push(`${page}: no label for="${id}" and no aria-label`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test("every declared id in a page is unique", () => {
    const problems: string[] = [];
    for (const page of listPages()) {
      const html = readPage(page);
      const all = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] as string);
      const duplicates = all.filter((id, index) => all.indexOf(id) !== index);
      if (duplicates.length > 0) problems.push(`${page}: duplicate ids ${[...new Set(duplicates)].join(", ")}`);
    }
    expect(problems).toEqual([]);
  });
});
