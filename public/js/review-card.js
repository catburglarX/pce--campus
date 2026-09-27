/**
 * One review in the list, with everything a student or admin can do to it.
 *
 * Buttons are only drawn when the action is available to this viewer, and the server rechecks every one
 * of them. A hidden button is convenience, never a control.
 */

import { patch, post, remove } from "./api.js";
import { chip, el, formatDateTime, mount, starRow, toast } from "./dom.js";
import { buildThread } from "./review-thread.js";

function metaLine(review) {
  return el("div", { class: "entry__meta" }, [
    chip(review.categoryName),
    review.subject ? el("span", { text: review.subject }) : null,
    el("span", { text: review.isMine ? "You" : review.authorName }),
    el("span", { text: formatDateTime(review.createdAt) }),
    review.createdAt === review.updatedAt ? null : el("span", { text: "edited" }),
    review.status === "hidden" ? chip("Hidden by admin", "hidden") : null,
    review.flagCount > 0 ? chip(`${review.flagCount} report(s)`, "rejected") : null,
  ]);
}

function helpfulButton(review) {
  const button = el("button", {
    class: `btn btn--small ${review.iFoundHelpful ? "btn--pressed" : "btn--secondary"}`,
    attrs: { type: "button", "aria-pressed": review.iFoundHelpful ? "true" : "false" },
    text: `Helpful (${review.helpfulCount})`,
  });
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const outcome = await post(`/api/reviews/${review.id}/helpful`, {});
      button.textContent = `Helpful (${outcome.helpfulCount})`;
      button.className = `btn btn--small ${outcome.iFoundHelpful ? "btn--pressed" : "btn--secondary"}`;
      button.setAttribute("aria-pressed", outcome.iFoundHelpful ? "true" : "false");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function reportButton(review, context) {
  return el("button", {
    class: "btn btn--ghost btn--small",
    text: "Report",
    attrs: { type: "button" },
    on: {
      click: async () => {
        const reason = window.prompt("Why should an admin look at this review?");
        if (reason === null) return;
        if (reason.trim().length < 4) {
          toast("Give a reason of at least four characters.", "error");
          return;
        }
        try {
          await post(`/api/reviews/${review.id}/report`, { reason: reason.trim() });
          toast("Reported. An admin will see it in the moderation queue.");
          await context.reload();
        } catch (error) {
          toast(error.message, "error");
        }
      },
    },
  });
}

function deleteButton(review, context) {
  return el("button", {
    class: "btn btn--danger btn--small",
    text: "Delete",
    attrs: { type: "button" },
    on: {
      click: async () => {
        if (!window.confirm("Delete this review? This cannot be undone.")) return;
        try {
          await remove(`/api/reviews/${review.id}`);
          toast("Review deleted.");
          await context.reload();
        } catch (error) {
          toast(error.message, "error");
        }
      },
    },
  });
}

function openEditForm(review, context, card) {
  if (card.querySelector("form.edit-form")) return;
  const form = el("form", { class: "stack edit-form", attrs: { novalidate: "" } });
  const title = el("input", { attrs: { type: "text", "aria-label": "Title", maxlength: "120" } });
  title.value = review.title;
  const body = el("textarea", { attrs: { "aria-label": "Review text", rows: "4", maxlength: "4000" } });
  body.value = review.body;
  const stars = el("select", { attrs: { "aria-label": "Stars out of 5" } });
  for (let value = 1; value <= 5; value += 1) {
    const option = el("option", {
      text: `${value} star${value === 1 ? "" : "s"}`,
      attrs: { value: String(value) },
    });
    if (review.stars === value) option.selected = true;
    stars.append(option);
  }
  const save = el("button", { class: "btn btn--small", text: "Save changes", attrs: { type: "submit" } });

  form.append(
    title,
    body,
    stars,
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
      await patch(`/api/reviews/${review.id}`, {
        categoryId: review.categoryId,
        subject: review.subject,
        title: title.value.trim(),
        body: body.value.trim(),
        stars: Number(stars.value),
        isAnonymous: review.isAnonymous,
      });
      toast("Review updated.");
      await context.reload();
    } catch (error) {
      toast(error.message, "error");
      save.disabled = false;
    }
  });

  card.append(form);
  title.focus();
}

async function setVisibility(review, context, hide) {
  const reason = hide ? window.prompt("Reason for hiding this review? The author will see it.") : "";
  if (hide && reason === null) return;
  try {
    const path = hide ? `/api/admin/reviews/${review.id}/hide` : `/api/admin/reviews/${review.id}/restore`;
    await post(path, hide ? { reason: (reason ?? "").trim() } : {});
    toast(hide ? "Review hidden." : "Review restored.");
    await context.reload();
  } catch (error) {
    toast(error.message, "error");
  }
}

function moderationButton(review, context) {
  const hiding = review.status === "visible";
  return el("button", {
    class: hiding ? "btn btn--danger btn--small" : "btn btn--small",
    text: hiding ? "Hide" : "Restore",
    attrs: { type: "button" },
    on: { click: () => setVisibility(review, context, hiding) },
  });
}

/** context: { isAdmin, reload }. */
export function buildReviewCard(review, context) {
  const classes = ["entry"];
  if (review.status === "hidden") classes.push("entry--hidden");
  else if (review.isMine) classes.push("entry--mine");

  const card = el("li", { class: classes.join(" ") });
  const actions = el("div", { class: "entry__actions" });

  card.append(
    el("div", { class: "entry__top" }, [
      el("h3", { class: "entry__title", text: review.title }),
      starRow(review.stars),
    ]),
    metaLine(review),
    review.status === "hidden" && review.hiddenReason
      ? el("p", { class: "entry__note", text: `Hidden by an admin: ${review.hiddenReason}` })
      : null,
    el("p", { class: "entry__body", text: review.body }),
    actions,
    buildThread(review, context),
  );

  if (!review.isMine && review.status === "visible") {
    actions.append(helpfulButton(review), reportButton(review, context));
  }
  if (review.isMine) {
    actions.append(
      el("button", {
        class: "btn btn--secondary btn--small",
        text: "Edit",
        attrs: { type: "button" },
        on: { click: () => openEditForm(review, context, card) },
      }),
      deleteButton(review, context),
    );
  } else if (context.isAdmin) {
    actions.append(deleteButton(review, context));
  }
  if (context.isAdmin) actions.append(moderationButton(review, context));

  return card;
}

export function renderReviewList(listNode, reviews, context) {
  if (reviews.length === 0) {
    mount(
      listNode,
      el("li", { class: "empty-state", text: "No reviews match that. Try a different filter." }),
    );
    return;
  }
  mount(listNode, ...reviews.map((review) => buildReviewCard(review, context)));
}
