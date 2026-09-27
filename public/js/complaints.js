/**
 * Complaints page: raise one, filter the board, support someone else's, and for an admin, move a
 * complaint through its statuses with a note the student will read.
 */

import { get, patch, post, remove } from "./api.js";
import {
  chip,
  clearAlert,
  clearFieldErrors,
  el,
  formatDateTime,
  mount,
  showAlert,
  showFieldError,
  titleCaseStatus,
  toast,
} from "./dom.js";
import { runPage, startPage } from "./shell.js";

const STATUSES = ["open", "in_progress", "resolved", "rejected"];
const context = { isAdmin: false };
let categories = [];

function supportButton(complaint) {
  const button = el("button", {
    class: `btn btn--small ${complaint.iSupport ? "btn--pressed" : "btn--secondary"}`,
    attrs: { type: "button", "aria-pressed": complaint.iSupport ? "true" : "false" },
    text: `Same problem here (${complaint.supportCount})`,
  });
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const payload = await post(`/api/complaints/${complaint.id}/support`, {});
      button.textContent = `Same problem here (${payload.complaint.supportCount})`;
      button.className = `btn btn--small ${payload.complaint.iSupport ? "btn--pressed" : "btn--secondary"}`;
      button.setAttribute("aria-pressed", payload.complaint.iSupport ? "true" : "false");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function withdrawButton(complaint) {
  return el("button", {
    class: "btn btn--danger btn--small",
    text: complaint.isMine ? "Withdraw" : "Delete",
    attrs: { type: "button" },
    on: {
      click: async () => {
        if (!window.confirm("Remove this complaint?")) return;
        try {
          await remove(`/api/complaints/${complaint.id}`);
          toast("Complaint removed.");
          await loadList();
        } catch (error) {
          toast(error.message, "error");
        }
      },
    },
  });
}

function adminStatusForm(complaint) {
  const form = el("form", { class: "stack", attrs: { novalidate: "" } });
  const selectId = `status-${complaint.id}`;
  const noteId = `note-${complaint.id}`;

  const select = el("select", { attrs: { id: selectId, name: "status" } });
  for (const status of STATUSES) {
    const option = el("option", { text: titleCaseStatus(status), attrs: { value: status } });
    if (complaint.status === status) option.selected = true;
    select.append(option);
  }

  const note = el("textarea", { attrs: { id: noteId, name: "resolutionNote", rows: "2", maxlength: "1000" } });
  note.value = complaint.resolutionNote;

  const submit = el("button", { class: "btn btn--small", text: "Update status", attrs: { type: "submit" } });

  form.append(
    el("label", { class: "field__label", text: "Status", attrs: { for: selectId } }),
    select,
    el("label", { class: "field__label", text: "Note for the student", attrs: { for: noteId } }),
    el("span", {
      class: "field__hint",
      text: "Required when resolving or rejecting. Say what was actually done.",
    }),
    note,
    submit,
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await patch(`/api/complaints/${complaint.id}/status`, {
        status: select.value,
        resolutionNote: note.value.trim(),
      });
      toast("Status updated.");
      await loadList();
    } catch (error) {
      toast(error.message, "error");
      submit.disabled = false;
    }
  });

  return form;
}

function complaintCard(complaint) {
  const classes = ["entry"];
  if (complaint.isMine) classes.push("entry--mine");
  const actions = el("div", { class: "entry__actions" });

  const card = el("li", { class: classes.join(" ") }, [
    el("div", { class: "entry__top" }, [
      el("h3", { class: "entry__title", text: complaint.title }),
      chip(titleCaseStatus(complaint.status), complaint.status),
    ]),
    el("div", { class: "entry__meta" }, [
      chip(complaint.categoryName),
      complaint.severity === "high" ? chip("High urgency", "high") : chip(`${complaint.severity} urgency`),
      complaint.location ? el("span", { text: complaint.location }) : null,
      el("span", { text: complaint.isMine ? "You" : complaint.authorName }),
      el("span", { text: formatDateTime(complaint.createdAt) }),
    ]),
    el("p", { class: "entry__body", text: complaint.body }),
    complaint.resolutionNote
      ? el("p", { class: "entry__note" }, [
          el("strong", { text: `${titleCaseStatus(complaint.status)}: ` }),
          complaint.resolutionNote,
          complaint.resolvedByName ? ` — ${complaint.resolvedByName}` : "",
        ])
      : null,
    actions,
  ]);

  if (!complaint.isMine) actions.append(supportButton(complaint));
  else actions.append(el("span", { class: "chip", text: `${complaint.supportCount} student(s) agree` }));

  if (context.isAdmin || (complaint.isMine && complaint.status === "open")) {
    actions.append(withdrawButton(complaint));
  }

  if (context.isAdmin) {
    const details = el("details");
    details.append(el("summary", { text: "Change status" }), adminStatusForm(complaint));
    card.append(details);
  }

  return card;
}

function currentFilters() {
  const form = document.querySelector("#filter-form");
  const data = new FormData(form);
  return {
    status: String(data.get("status") ?? ""),
    category: String(data.get("category") ?? ""),
    mine: data.get("mine") === "on",
  };
}

async function loadList() {
  const filters = currentFilters();
  const list = document.querySelector("#list");
  mount(list, el("li", { class: "loading", text: "Loading complaints…" }));
  const parameters = new URLSearchParams();
  if (filters.status) parameters.set("status", filters.status);
  if (filters.category) parameters.set("category", filters.category);
  if (filters.mine) parameters.set("mine", "1");
  const query = parameters.toString();
  const payload = await get(query ? `/api/complaints?${query}` : "/api/complaints");

  if (payload.complaints.length === 0) {
    mount(list, el("li", { class: "empty-state", text: "Nothing here. That is good news, or a filter." }));
  } else {
    mount(list, ...payload.complaints.map(complaintCard));
  }
  const open = payload.complaints.filter((entry) => entry.status === "open").length;
  document.querySelector("#list-count").textContent =
    `${payload.complaints.length} shown, ${open} still open`;
}

function fillCategorySelects() {
  const raiseSelect = document.querySelector("#categoryId");
  const filterSelect = document.querySelector("#filter-category");
  for (const category of categories) {
    raiseSelect.append(el("option", { text: category.name, attrs: { value: String(category.id) } }));
    filterSelect.append(el("option", { text: category.name, attrs: { value: category.slug } }));
  }
}

function wireRaiseForm() {
  const form = document.querySelector("#raise-form");
  const alertBox = document.querySelector("#raise-alert");
  const submit = document.querySelector("#raise-submit");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAlert(alertBox);
    clearFieldErrors(form);
    submit.disabled = true;
    const data = new FormData(form);
    try {
      await post("/api/complaints", {
        categoryId: Number(data.get("categoryId")),
        title: String(data.get("title") ?? "").trim(),
        body: String(data.get("body") ?? "").trim(),
        location: String(data.get("location") ?? "").trim(),
        severity: String(data.get("severity") ?? "normal"),
        isAnonymous: data.get("isAnonymous") === "on",
      });
      form.reset();
      document.querySelector("#raise-details").open = false;
      toast("Complaint submitted. An admin will see it on the board.");
      await loadList();
    } catch (error) {
      const placed = error.field ? showFieldError(form, error.field, error.message) : false;
      if (!placed) showAlert(alertBox, error.message);
    } finally {
      submit.disabled = false;
    }
  });
}

runPage(async () => {
  const session = await startPage();
  context.isAdmin = session.user.role === "admin";
  categories = (await get("/api/categories")).categories;
  fillCategorySelects();
  wireRaiseForm();
  document.querySelector("#filter-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await loadList();
    } catch (error) {
      toast(error.message, "error");
    }
  });
  const requestedStatus = new URLSearchParams(window.location.search).get("status");
  if (requestedStatus && STATUSES.includes(requestedStatus)) {
    document.querySelector("#filter-status").value = requestedStatus;
  }
  await loadList();
});
