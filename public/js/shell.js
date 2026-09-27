/**
 * Shared page shell.
 *
 * Every signed-in page calls startPage(), which loads the session, fills in the header and navigation,
 * marks the current page, and hands the caller the user. The admin link only exists for an admin, and the
 * server refuses /admin to a student regardless, so the hidden link is convenience rather than a control.
 */

import { get, post, setCsrfToken } from "./api.js";
import { clear, el, toast } from "./dom.js";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/mess", label: "Mess food" },
  { href: "/reviews", label: "Campus reviews" },
  { href: "/complaints", label: "Complaints" },
  { href: "/notices", label: "Notices" },
  { href: "/profile", label: "My account" },
];

function buildNav(currentPath, isAdmin) {
  const list = el("ul");
  const items = isAdmin ? [...NAV_ITEMS, { href: "/admin", label: "Admin" }] : NAV_ITEMS;
  for (const item of items) {
    const isCurrent = item.href === currentPath;
    list.append(
      el("li", {}, [
        el("a", {
          text: item.label,
          attrs: { href: item.href, "aria-current": isCurrent ? "page" : null },
        }),
      ]),
    );
  }
  return el("nav", { class: "main-nav", attrs: { "aria-label": "Main" } }, [list]);
}

async function signOut() {
  try {
    await post("/api/auth/logout", {});
  } catch (error) {
    toast(error.message, "error");
    return;
  }
  window.location.assign("/login");
}

function buildHeader(user, currentPath) {
  const strip = el("div", { class: "session-strip" }, [
    el("span", { text: `${user.name} · ${user.role === "admin" ? "Campus admin" : "Student"}` }),
    el("button", {
      class: "btn btn--secondary btn--small",
      text: "Sign out",
      attrs: { type: "button" },
      on: { click: signOut },
    }),
  ]);

  const bar = el("div", { class: "app-header__bar" }, [
    el("a", { class: "brand", attrs: { href: "/" } }, [
      el("span", { class: "brand__mark", text: "PCE" }),
      el("span", {}, [
        el("span", { text: "Campus Voice" }),
        el("span", { class: "brand__tag", text: "Poornima College of Engineering, students only" }),
      ]),
    ]),
    strip,
  ]);

  return el("header", { class: "app-header" }, [
    el("div", { class: "app-header__inner" }, [bar, buildNav(currentPath, user.role === "admin")]),
  ]);
}

/**
 * Loads the session and renders the shell.
 *
 * @returns {Promise<{user: Object, activity: Object, joinCodeHint: string|null}>}
 */
export async function startPage() {
  const mountPoint = document.querySelector("#app-header");
  let payload;
  try {
    payload = await get("/api/auth/me");
  } catch (error) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.assign(`/login?next=${next}`);
    throw error;
  }
  setCsrfToken(payload.csrfToken);
  if (mountPoint) {
    clear(mountPoint);
    mountPoint.append(buildHeader(payload.user, window.location.pathname));
  }
  if (new URLSearchParams(window.location.search).get("denied") === "admin") {
    toast("That page is for campus admins only.", "error");
  }
  return payload;
}

/** Wraps a page's own render function so one thrown error shows a message instead of a blank screen. */
export function runPage(render) {
  window.addEventListener("DOMContentLoaded", () => {
    render().catch((error) => {
      console.error(error);
      toast(error.message ?? "Something went wrong while loading this page.", "error");
    });
  });
}
