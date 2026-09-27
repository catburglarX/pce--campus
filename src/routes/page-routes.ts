/**
 * Page routes.
 *
 * The session check happens here, before any HTML is written, so a signed-out visitor is redirected
 * rather than being shown a shell that later discovers it has no data. The admin page is refused to
 * students at this layer as well as in every admin API handler.
 */

import { redirectTo } from "../http";
import type { RequestContext, Route } from "../router";
import { servePage } from "../static-files";

type PageDefinition = { path: string; file: string; access: "public" | "student" | "admin" };

const PAGES: PageDefinition[] = [
  { path: "/login", file: "login.html", access: "public" },
  { path: "/register", file: "register.html", access: "public" },
  { path: "/", file: "dashboard.html", access: "student" },
  { path: "/mess", file: "mess.html", access: "student" },
  { path: "/reviews", file: "reviews.html", access: "student" },
  { path: "/complaints", file: "complaints.html", access: "student" },
  { path: "/notices", file: "notices.html", access: "student" },
  { path: "/profile", file: "profile.html", access: "student" },
  { path: "/admin", file: "admin.html", access: "admin" },
];

function buildHandler(page: PageDefinition) {
  return async (context: RequestContext): Promise<Response> => {
    const session = context.session;
    if (page.access === "public") {
      return session ? redirectTo("/") : servePage(page.file);
    }
    if (!session) {
      const target = `${context.url.pathname}${context.url.search}`;
      return redirectTo(`/login?next=${encodeURIComponent(target)}`);
    }
    if (page.access === "admin" && session.user.role !== "admin") {
      return redirectTo("/?denied=admin");
    }
    return servePage(page.file);
  };
}

export const pageRoutes: Route[] = PAGES.map((page) => ({
  method: "GET" as const,
  pattern: page.path,
  handler: buildHandler(page),
}));
