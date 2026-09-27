/**
 * One meal on the mess page: the menu, the current average, the student's own rating and the form.
 *
 * Split from mess.js because the rating form changes for different reasons than day navigation and the
 * weekly menu table do.
 */

import { get, post, remove } from "./api.js";
import { el, formatDateTime, readRadio, starFieldset, starRow, toast } from "./dom.js";

function verdictFor(average) {
  if (average === null || average === undefined) return "Not rated yet";
  if (average >= 4.5) return "Excellent";
  if (average >= 3.5) return "Good";
  if (average >= 2.5) return "Average";
  if (average >= 1.5) return "Poor";
  return "Very poor";
}

function scoreChip(label, value) {
  return el("span", { class: "chip", text: `${label}: ${value === null || value === undefined ? "–" : value}` });
}

function commentField(meal, existing) {
  const id = `${meal.meal}-comment`;
  const input = el("textarea", { attrs: { id, name: "comment", maxlength: "1000", rows: "3" } });
  input.value = existing?.comment ?? "";
  input.setAttribute("aria-describedby", `${id}-hint`);
  const wrapper = el("div", { class: "field" }, [
    el("label", { class: "field__label", text: "What was it like?", attrs: { for: id } }),
    el("span", {
      class: "field__hint",
      attrs: { id: `${id}-hint` },
      text: "Optional. Say what was good or wrong so the mess committee can act on it.",
    }),
    input,
  ]);
  return { wrapper, input };
}

function anonymousField(meal, existing) {
  const id = `${meal.meal}-anon`;
  const input = el("input", { attrs: { type: "checkbox", id, name: "isAnonymous" } });
  if (existing?.isAnonymous) input.checked = true;
  const wrapper = el("div", { class: "field" }, [
    el("label", { class: "checkbox", attrs: { for: id } }, [
      input,
      el("span", { text: "Post this without my name" }),
    ]),
  ]);
  return { wrapper, input };
}

function deleteButton(ratingId, context) {
  return el("button", {
    class: "btn btn--secondary",
    text: "Delete my rating",
    attrs: { type: "button" },
    on: {
      click: async () => {
        if (!window.confirm("Remove your rating for this meal?")) return;
        try {
          await remove(`/api/mess/ratings/${ratingId}`);
          toast("Your rating was removed.");
          await context.reload();
        } catch (error) {
          toast(error.message, "error");
        }
      },
    },
  });
}

function buildRatingForm(meal, existing, context) {
  const form = el("form", { class: "stack", attrs: { novalidate: "" } });
  const comment = commentField(meal, existing);
  const anonymous = anonymousField(meal, existing);
  const submit = el("button", {
    class: "btn",
    text: existing ? "Update my rating" : "Submit rating",
    attrs: { type: "submit" },
  });
  const actions = el("div", { class: "btn-row" }, [submit]);
  if (existing) actions.append(deleteButton(existing.id, context));

  form.append(
    starFieldset(`${meal.meal}-stars`, "Overall, out of 5", existing?.stars),
    starFieldset(`${meal.meal}-taste`, "Taste", existing?.taste ?? undefined),
    starFieldset(`${meal.meal}-hygiene`, "Hygiene", existing?.hygiene ?? undefined),
    starFieldset(`${meal.meal}-quantity`, "Quantity served", existing?.quantity ?? undefined),
    comment.wrapper,
    anonymous.wrapper,
    actions,
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const stars = readRadio(form, `${meal.meal}-stars`);
    if (stars === null) {
      toast("Choose an overall rating out of 5 first.", "error");
      return;
    }
    submit.disabled = true;
    try {
      await post("/api/mess/ratings", {
        servedOn: context.date,
        meal: meal.meal,
        stars,
        taste: readRadio(form, `${meal.meal}-taste`),
        hygiene: readRadio(form, `${meal.meal}-hygiene`),
        quantity: readRadio(form, `${meal.meal}-quantity`),
        comment: comment.input.value.trim(),
        isAnonymous: anonymous.input.checked,
      });
      toast("Rating saved. Thanks for logging it.");
      await context.reload();
    } catch (error) {
      toast(error.message, "error");
      submit.disabled = false;
    }
  });

  return form;
}

async function buildFeedbackList(meal, context) {
  const list = el("ul", { class: "comment-list" });
  try {
    const payload = await get(`/api/mess/ratings?date=${context.date}&meal=${meal.meal}`);
    const written = payload.ratings.filter((rating) => rating.comment.length > 0);
    if (written.length === 0) {
      list.append(el("li", { class: "comment muted", text: "No written feedback for this meal yet." }));
    }
    for (const rating of written) {
      list.append(
        el("li", { class: "comment" }, [
          el("span", { class: "comment__author", text: rating.isMine ? "You" : rating.authorName }),
          " ",
          starRow(rating.stars),
          el("div", { text: rating.comment }),
          el("span", { class: "caption muted", text: formatDateTime(rating.updatedAt) }),
        ]),
      );
    }
  } catch (error) {
    list.append(el("li", { class: "comment", text: `Could not load feedback: ${error.message}` }));
  }
  return list;
}

/** Builds the card for one meal. context carries the date, the meal labels and a reload callback. */
export function buildMealCard(meal, canRate, context) {
  const card = el("article", { class: "card" });
  card.append(
    el("div", { class: "card__head" }, [
      el("h3", { text: context.labels[meal.meal] ?? meal.meal }),
      starRow(meal.aggregate.averageStars, {
        verdict: verdictFor(meal.aggregate.averageStars),
        count: meal.aggregate.ratingCount,
      }),
    ]),
    el("p", { class: "meal-card__menu", text: meal.menuItems }),
    el("div", { class: "entry__meta" }, [
      scoreChip("Taste", meal.aggregate.averageTaste),
      scoreChip("Hygiene", meal.aggregate.averageHygiene),
      scoreChip("Quantity", meal.aggregate.averageQuantity),
    ]),
  );

  if (meal.myRating) {
    card.append(
      el("p", { class: "entry__note" }, [
        "Your rating: ",
        starRow(meal.myRating.stars),
        meal.myRating.comment ? ` ${meal.myRating.comment}` : "",
      ]),
    );
  }

  if (canRate) {
    const rate = el("details");
    rate.append(
      el("summary", { text: meal.myRating ? "Change my rating" : "Rate this meal" }),
      buildRatingForm(meal, meal.myRating, context),
    );
    card.append(rate);
  } else {
    card.append(el("p", { class: "caption muted", text: "Rating is closed for this day." }));
  }

  const feedback = el("details");
  feedback.append(el("summary", { text: "What students wrote" }));
  feedback.addEventListener("toggle", async () => {
    if (!feedback.open || feedback.dataset.loaded === "yes") return;
    feedback.dataset.loaded = "yes";
    feedback.append(await buildFeedbackList(meal, context));
  });
  card.append(feedback);

  return card;
}
