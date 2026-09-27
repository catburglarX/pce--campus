/**
 * Static asset serving for the stylesheet, the page scripts and the favicon.
 *
 * Every requested path is resolved and then checked to be inside public/, because a request for
 * /css/../../src/config.ts would otherwise read source off disk.
 */

import { join, normalize, resolve, sep } from "node:path";

import { withSecurityHeaders } from "./http";

const PUBLIC_ROOT = resolve(join(import.meta.dir, "..", "public"));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function contentTypeFor(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  const extension = dot === -1 ? "" : filePath.slice(dot).toLowerCase();
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

/**
 * Resolves a URL path inside public/, or null when it must not be served.
 *
 * A ".." segment is refused outright rather than normalised away. Windows path normalisation clamps
 * "/css/../../x" back to "/x" and would hand back a path that happens to sit inside public/, which is
 * safe by accident rather than by rule. Refusing the intent keeps the rule checkable.
 */
export function resolvePublicPath(urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  if (decoded.split(/[\\/]+/).includes("..")) return null;
  const candidate = resolve(join(PUBLIC_ROOT, normalize(decoded)));
  if (candidate !== PUBLIC_ROOT && !candidate.startsWith(PUBLIC_ROOT + sep)) return null;
  return candidate;
}

export async function serveStaticAsset(urlPath: string): Promise<Response | null> {
  const filePath = resolvePublicPath(urlPath);
  if (!filePath) return null;
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;
  const headers = new Headers({
    "Content-Type": contentTypeFor(filePath),
    "Cache-Control": "no-cache",
  });
  return new Response(file, { headers: withSecurityHeaders(headers) });
}

/** HTML shells are served with no-store so a signed-out browser cannot show a cached signed-in page. */
export async function servePage(fileName: string): Promise<Response> {
  const filePath = resolvePublicPath(fileName);
  if (!filePath) return new Response("Not found", { status: 404 });
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return new Response(`Page ${fileName} is missing from public/`, { status: 500 });
  }
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  return new Response(file, { headers: withSecurityHeaders(headers) });
}
