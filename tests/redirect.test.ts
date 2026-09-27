/**
 * The post sign-in redirect must never leave this origin, whatever the "next" parameter says.
 */

import { describe, expect, test } from "bun:test";
// @ts-expect-error plain browser ES module without type declarations
import { safeNextPath } from "../public/js/redirect.js";

const ORIGIN = "http://localhost:4173";
const next = (value: string): string => safeNextPath(`?next=${encodeURIComponent(value)}`, ORIGIN);

describe("safeNextPath", () => {
  test("keeps a local path with its query and fragment", () => {
    expect(next("/reviews?category=3#top")).toBe("/reviews?category=3#top");
  });

  test("falls back to the home page when next is missing or empty", () => {
    expect(safeNextPath("", ORIGIN)).toBe("/");
    expect(safeNextPath("?next=", ORIGIN)).toBe("/");
  });

  test.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "reviews",
  ])("refuses %p", (value) => {
    expect(next(value)).toBe("/");
  });
});
