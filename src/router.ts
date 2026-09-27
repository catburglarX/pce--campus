/**
 * Routing: a table of method and path patterns matched to handlers.
 *
 * Patterns use :name for a segment parameter, for example /api/reviews/:id. Matching is exact on
 * segment count, so /api/reviews/1/vote never falls through to /api/reviews/:id.
 */

import type { ResolvedSession } from "./services/sessions";

export type RequestContext = {
  request: Request;
  url: URL;
  params: Record<string, string>;
  session: ResolvedSession | null;
  clientAddress: string;
};

export type RouteHandler = (context: RequestContext) => Promise<Response> | Response;

export type Route = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  pattern: string;
  handler: RouteHandler;
};

export type RouteMatch = { handler: RouteHandler; params: Record<string, string> };

function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

function matchSegments(patternSegments: string[], pathSegments: string[]): Record<string, string> | null {
  if (patternSegments.length !== pathSegments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index] as string;
    const pathSegment = pathSegments[index] as string;
    if (patternSegment.startsWith(":")) {
      params[patternSegment.slice(1)] = decodeURIComponent(pathSegment);
      continue;
    }
    if (patternSegment !== pathSegment) return null;
  }
  return params;
}

export function matchRoute(routes: readonly Route[], method: string, pathname: string): RouteMatch | null {
  const pathSegments = splitPath(pathname);
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchSegments(splitPath(route.pattern), pathSegments);
    if (params) return { handler: route.handler, params };
  }
  return null;
}

/** True when any route would match this path under a different method, so the answer is 405 not 404. */
export function pathExistsForOtherMethod(routes: readonly Route[], pathname: string): boolean {
  const pathSegments = splitPath(pathname);
  return routes.some((route) => matchSegments(splitPath(route.pattern), pathSegments) !== null);
}
