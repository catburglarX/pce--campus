/**
 * Notices page. Students read; an admin publishes, edits and deletes. The post form is hidden for a
 * student and the server refuses the write regardless of what the page shows.
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
  toast,
} from "./dom.js";
import { runPage, startPage } from "./shell.js";

const context = { isAdmin: false };

function openEditForm(notice, card) {
  if (card.querySelector("form")) return;
  const form = el("form", { class: "stack", attrs: { novalidate: "" } });
  const title = el("input", { attrs: { type: "text", "aria-label": "Notice title", maxlength: "140" } });
  title.value = notice.title;
  const body = el("textarea", { attrs: { "aria-label": "Notice text", rows: "4", maxlength: "3000" } });
  body.value = notice.body;
  const pinned = el("input", { attrs: { type: "checkbox", id: `pin-${notice.id}` } });
  pinned.checked = notice.isPinned;
  const save = el("button", { class: "btn btn--small", text: "Save", attrs: { type: "submit" } });

  form.append(
    title,
    body,
    el("label", { class: "checkbox", attrs: { for: `pin-${notice.id}` } }, [
      pinned,
      el("span", { text: "Pinned" }),
    ]),
    el("div", { class: "btn-row" }, [
      save,
      el("button", {
        class: "btn btn--secondary btn--small",
        text: "Cancel",
        attrs: { type: "button" },
        on: { click: () => form.remove() },
      }),
    ]),
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      await patch(`/api/notices/${notice.id}`, {
        title: title.value.trim(),
        body: body.value.trim(),
        isPinned: pinned.checked,
      });
      toast("Notice updated.");
      await loadList();
    } catch (error) {
      toast(error.message, "error");
      save.disabled = false;
    }
  });

  card.append(form);
  title.focus();
}

function noticeCard(notice) {
  const card = el("li", { class: "entry" }, [
    el("div", { class: "entry__top" }, [
      el("h3", { class: "entry__title", text: notice.title }),
      notice.isPinned ? chip("Pinned", "pinned") : null,
    ]),
    el("div", { class: "entry__meta" }, [
      el("span", { text: notice.authorName }),
      el("span", { text: formatDateTime(notice.createdAt) }),
      notice.createdAt === notice.updatedAt ? null : el("span", { text: "edited" }),
    ]),
    el("p", { class: "entry__body", text: notice.body }),
  ]);

  if (!context.isAdmin) return card;

  card.append(
    el("div", { class: "entry__actions" }, [
      el("button", {
        class: "btn btn--secondary btn--small",
        text: "Edit",
        attrs: { type: "button" },
        on: { click: () => openEditForm(notice, card) },
      }),
      el("button", {
        class: "btn btn--danger btn--small",
        text: "Delete",
        attrs: { type: "button" },
        on: {
          click: async () => {
            if (!window.confirm("Delete this notice?")) return;
            try {
              await remove(`/api/notices/${notice.id}`);
              toast("Notice deleted.");
              await loadList();
            } catch (error) {
              toast(error.message, "error");
            }
          },
        },
      }),
    ]),
  );
  return card;
}

async function loadList() {
  const list = document.querySelector("#list");
  mount(list, el("li", { class: "loading", text: "Loading notices…" }));
  const payload = await get("/api/notices");
  if (payload.notices.length === 0) {
    mount(list, el("li", { class: "empty-state", text: "No notices published yet." }));
    return;
  }
  mount(list, ...payload.notices.map(noticeCard));
}

function wirePostForm() {
  const section = document.querySelector("#post-section");
  section.hidden = false;
  const form = document.querySelector("#post-form");
  const alertBox = document.querySelector("#post-alert");
  const submit = document.querySelector("#post-submit");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAlert(alertBox);
    clearFieldErrors(form);
    submit.disabled = true;
    const data = new FormData(form);
    try {
      await post("/api/notices", {
        title: String(data.get("title") ?? "").trim(),
        body: String(data.get("body") ?? "").trim(),
        isPinned: data.get("isPinned") === "on",
      });
      form.reset();
      toast("Notice published.");
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
  if (context.isAdmin) wirePostForm();
  await loadList();
});
