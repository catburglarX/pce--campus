/**
 * Admin page. Every action here calls an endpoint that checks the admin role again on the server, so
 * reaching this page by typing the URL as a student achieves nothing.
 */

import { get, patch, post } from "./api.js";
import { chip, el, formatDateTime, mount, starRow, titleCaseStatus, toast } from "./dom.js";
import { runPage, startPage } from "./shell.js";

let currentAdminId = 0;

async function act(action, successMessage) {
  try {
    await action();
    toast(successMessage);
    await loadEverything();
  } catch (error) {
    toast(error.message, "error");
  }
}

function reportCard(report) {
  const actions = el("div", { class: "entry__actions" });
  const card = el("li", { class: "entry entry--hidden" }, [
    el("div", { class: "entry__top" }, [
      el("h3", { class: "entry__title", text: report.title }),
      starRow(report.stars),
    ]),
    el("div", { class: "entry__meta" }, [
      chip(report.categoryName),
      el("span", { text: report.authorName }),
      el("span", { text: formatDateTime(report.createdAt) }),
      chip(report.status === "hidden" ? "Hidden" : "Visible", report.status === "hidden" ? "hidden" : "open"),
    ]),
    el("p", { class: "entry__body", text: report.body }),
    el("div", { class: "entry__note" }, [
      el("strong", { text: "Reported for: " }),
      report.flagReasons.join(" | "),
    ]),
    actions,
  ]);

  if (report.status === "visible") {
    actions.append(
      el("button", {
        class: "btn btn--danger btn--small",
        text: "Hide it",
        attrs: { type: "button" },
        on: {
          click: () => {
            const reason = window.prompt("Reason the author will see:");
            if (reason === null) return;
            act(
              () => post(`/api/admin/reviews/${report.id}/hide`, { reason: reason.trim() }),
              "Review hidden.",
            );
          },
        },
      }),
    );
  } else {
    actions.append(
      el("button", {
        class: "btn btn--small",
        text: "Restore it",
        attrs: { type: "button" },
        on: { click: () => act(() => post(`/api/admin/reviews/${report.id}/restore`, {}), "Review restored.") },
      }),
    );
  }

  actions.append(
    el("button", {
      class: "btn btn--secondary btn--small",
      text: "Dismiss reports",
      attrs: { type: "button" },
      on: {
        click: () =>
          act(() => post(`/api/admin/reviews/${report.id}/clear-reports`, {}), "Reports cleared."),
      },
    }),
  );

  return card;
}

function rosterRow(student) {
  const isSelf = student.id === currentAdminId;
  const actions = el("div", { class: "btn-row" });

  if (!isSelf) {
    actions.append(
      el("button", {
        class: "btn btn--secondary btn--small",
        text: student.role === "admin" ? "Make student" : "Make admin",
        attrs: { type: "button" },
        on: {
          click: () =>
            act(
              () =>
                patch(`/api/admin/users/${student.id}/role`, {
                  role: student.role === "admin" ? "student" : "admin",
                }),
              "Role updated.",
            ),
        },
      }),
      el("button", {
        class: "btn btn--danger btn--small",
        text: "Deactivate",
        attrs: { type: "button" },
        on: {
          click: () => {
            if (!window.confirm(`Deactivate ${student.email}? Their sessions end immediately.`)) return;
            act(() => patch(`/api/admin/users/${student.id}/active`, { isActive: false }), "Account deactivated.");
          },
        },
      }),
      el("button", {
        class: "btn btn--secondary btn--small",
        text: "Reactivate",
        attrs: { type: "button" },
        on: {
          click: () =>
            act(() => patch(`/api/admin/users/${student.id}/active`, { isActive: true }), "Account reactivated."),
        },
      }),
    );
  } else {
    actions.append(el("span", { class: "caption muted", text: "This is you" }));
  }

  return el("tr", {}, [
    el("th", { attrs: { scope: "row" }, text: student.name }),
    el("td", { text: student.email }),
    el("td", { text: student.branch || "–" }),
    el("td", {}, [chip(student.role === "admin" ? "Admin" : "Student", student.role === "admin" ? "pinned" : undefined)]),
    el("td", {}, [actions]),
  ]);
}

function auditRow(entry) {
  return el("tr", {}, [
    el("td", { text: formatDateTime(entry.createdAt) }),
    el("td", { text: entry.actorName ?? "removed account" }),
    el("td", { text: titleCaseStatus(entry.action.replace(".", ": ")) }),
    el("td", { text: entry.targetId === null ? entry.targetType : `${entry.targetType} #${entry.targetId}` }),
    el("td", { text: entry.detail || "–" }),
  ]);
}

async function loadEverything() {
  const [reportsPayload, rosterPayload] = await Promise.all([
    get("/api/admin/reports"),
    get("/api/admin/roster"),
  ]);

  const reportList = document.querySelector("#reports");
  if (reportsPayload.reports.length === 0) {
    mount(reportList, el("li", { class: "empty-state", text: "No reported reviews. Nothing to moderate." }));
  } else {
    mount(reportList, ...reportsPayload.reports.map(reportCard));
  }
  document.querySelector("#reports-count").textContent =
    `${reportsPayload.reports.length} review(s) reported`;

  mount(document.querySelector("#roster tbody"), ...rosterPayload.students.map(rosterRow));

  const auditBody = document.querySelector("#audit tbody");
  if (rosterPayload.audit.length === 0) {
    mount(auditBody, el("tr", {}, [el("td", { attrs: { colspan: "5" }, text: "Nothing logged yet." })]));
  } else {
    mount(auditBody, ...rosterPayload.audit.map(auditRow));
  }
}

runPage(async () => {
  const session = await startPage();
  currentAdminId = session.user.id;
  document.querySelector("#join-code").textContent = session.joinCodeHint ?? "hidden";
  await loadEverything();
});
