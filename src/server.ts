/**
 * Server assembly and startup.
 *
 * The request pipeline is: resolve the session cookie, try a static asset, match a route, run the
 * handler, convert any thrown AppError into a response. Handlers never build a status code themselves.
 */

import type { Server } from "bun";

import { config } from "./config";
import { errorResponse, jsonResponse, parseCookies, SESSION_COOKIE, withSecurityHeaders } from "./http";
import { matchRoute, pathExistsForOtherMethod, type RequestContext, type Route } from "./router";
import { serveStaticAsset } from "./static-files";
import { useDatabase } from "./db/connection";
import { seedBaseData } from "./db/seed";
import { purgeExpiredSessions, resolveSession } from "./services/sessions";
import { prunePassedWindows } from "./ratelimit";
import { authRoutes } from "./routes/auth-routes";
import { messRoutes } from "./routes/mess-routes";
import { reviewRoutes } from "./routes/review-routes";
import { campusRoutes } from "./routes/campus-routes";
import { adminRoutes } from "./routes/admin-routes";
import { pageRoutes } from "./routes/page-routes";

const ROUTES: Route[] = [
  ...pageRoutes,
  ...authRoutes,
  ...messRoutes,
  ...reviewRoutes,
  ...campusRoutes,
  ...adminRoutes,
];

const STATIC_PREFIXES = ["/css/", "/js/"];
const STATIC_FILES = ["/favicon.svg"];

function isStaticRequest(pathname: string): boolean {
  return STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || STATIC_FILES.includes(pathname);
}

/** This server has no websocket routes, so the Bun Server type carries no socket payload type. */
type CampusServer = Server<undefined>;

/**
 * The address used for rate-limit keys.
 *
 * The socket address is used when there is one. X-Forwarded-For is only consulted when
 * TRUST_PROXY_HEADER is set, because a client can put anything in that header and would otherwise get a
 * fresh login-attempt budget on every request by changing it.
 */
function readClientAddress(request: Request, server: CampusServer | null): string {
  try {
    const direct = server?.requestIP(request)?.address;
    if (direct) return direct;
  } catch {
    // requestIP is unavailable when the handler is called directly from a test.
  }
  if (config.trustProxyHeader) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return "local";
}

function buildContext(request: Request, url: URL, server: CampusServer | null): RequestContext {
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE] ?? "";
  return {
    request,
    url,
    params: {},
    session: token ? resolveSession(token) : null,
    clientAddress: readClientAddress(request, server),
  };
}

function notFoundResponse(url: URL): Response {
  if (url.pathname.startsWith("/api/")) {
    return jsonResponse({ error: { code: "not_found", message: `No endpoint at ${url.pathname}`, field: null } }, 404);
  }
  const headers = new Headers({ "Content-Type": "text/plain; charset=utf-8" });
  return new Response(`No page at ${url.pathname}`, { status: 404, headers: withSecurityHeaders(headers) });
}

export async function handleRequest(request: Request, server: CampusServer | null = null): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method === "HEAD" ? "GET" : request.method;
  try {
    if (method === "GET" && isStaticRequest(url.pathname)) {
      const asset = await serveStaticAsset(url.pathname);
      if (asset) return asset;
      return notFoundResponse(url);
    }
    const match = matchRoute(ROUTES, method, url.pathname);
    if (!match) {
      if (pathExistsForOtherMethod(ROUTES, url.pathname)) {
        return jsonResponse(
          { error: { code: "not_found", message: `${request.method} is not allowed on ${url.pathname}`, field: null } },
          405,
        );
      }
      return notFoundResponse(url);
    }
    const context = buildContext(request, url, server);
    context.params = match.params;
    const response = await match.handler(context);
    return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
  } catch (error) {
    return errorResponse(error);
  }
}

export type StartedServer = { server: CampusServer; url: string };

export async function startServer(): Promise<StartedServer> {
  useDatabase(config.databasePath);
  await seedBaseData();
  purgeExpiredSessions();
  prunePassedWindows();

  const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    development: false,
    fetch: (request, bunServer) => handleRequest(request, bunServer),
    error: (error) => errorResponse(error),
  });
  return { server, url: `http://${config.host}:${server.port}` };
}

if (import.meta.main) {
  const started = await startServer();
  console.log("PCE Campus Voice is running.");
  console.log(`  Open:      ${started.url}`);
  console.log(`  Database:  ${config.databasePath}`);
  console.log(`  Join code: ${config.joinCode}`);
  console.log("  Stop with Ctrl+C");
}
