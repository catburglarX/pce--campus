/**
 * The reply thread under a review: existing replies, deletion rights, and the form to add one.
 *
 * Replies load only when the thread is opened, so a page of ten reviews is one request rather than
 * eleven.
 */

import { get, post, remove } from "./api.js";
import { el, formatDateTime, toast } from "./dom.js";

function commentNode(comment, context) {
  const node = el("li", { class: "comment" }, [
    el("span", { class: "comment__author", text: comment.isMine ? "You" : comment.authorName }),
    el("span", { class: "caption muted", text: ` ${formatDateTime(comment.createdAt)}` }),
    el("div", { text: comment.body }),
  ]);
  if (!comment.isMine && !context.isAdmin) return node;
  node.append(
    el("button", {
      class: "btn btn--ghost btn--small",
      text: "Delete reply",
      attrs: { type: "button" },
      on: {
        click: async () => {
          if (!window.confirm("Delete this reply?")) return;
          try {
            await remove(`/api/comments/${comment.id}`);
            toast("Reply deleted.");
            await context.reload();
          } catch (error) {
            toast(error.message, "error");
          }
        },
      },
    }),
  );
  return node;
}

function buildReplyForm(review, context) {
  const form = el("form", { class: "stack", attrs: { novalidate: "" } });
  const id = `reply-${review.id}`;
  const input = el("textarea", {
    attrs: { id, rows: "2", maxlength: "1000", placeholder: "Add what you saw" },
  });
  const anonymous = el("input", { attrs: { type: "checkbox", id: `${id}-anon` } });
  const submit = el("button", { class: "btn btn--small", text: "Post reply", attrs: { type: "submit" } });

  form.append(
    el("label", { class: "field__label", text: "Reply", attrs: { for: id } }),
    input,
    el("label", { class: "checkbox", attrs: { for: `${id}-anon` } }, [
      anonymous,
      el("span", { text: "Without my name" }),
    ]),
    submit,
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (input.value.trim().length < 2) {
      toast("Write at least two characters.", "error");
      return;
    }
    submit.disabled = true;
    try {
      await post(`/api/reviews/${review.id}/comments`, {
        body: input.value.trim(),
        isAnonymous: anonymous.checked,
      });
      toast("Reply posted.");
      await context.reload();
    } catch (error) {
      toast(error.message, "error");
      submit.disabled = false;
    }
  });

  return form;
}

export function buildThread(review, context) {
  const details = el("details");
  details.append(
    el("summary", { text: review.commentCount === 0 ? "Replies" : `Replies (${review.commentCount})` }),
  );
  details.addEventListener("toggle", async () => {
    if (!details.open || details.dataset.loaded === "yes") return;
    details.dataset.loaded = "yes";
    const list = el("ul", { class: "comment-list" });
    try {
      const payload = await get(`/api/reviews/${review.id}`);
      if (payload.comments.length === 0) {
        list.append(el("li", { class: "comment muted", text: "No replies yet." }));
      }
      for (const comment of payload.comments) list.append(commentNode(comment, context));
    } catch (error) {
      list.append(el("li", { class: "comment", text: `Could not load replies: ${error.message}` }));
    }
    details.append(list, buildReplyForm(review, context));
  });
  return details;
}
