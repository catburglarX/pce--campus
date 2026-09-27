/**
 * Dashboard page.
 *
 * Reads one endpoint and draws six panels from it. The trend and the spread are drawn with elements and
 * utility classes rather than a chart library, which keeps the page dependency free and readable by a
 * screen reader through the text in each column.
 */

import { get } from "./api.js";
import { bar, el, fillClass, formatDate, mount, starRow, titleCaseStatus } from "./dom.js";
import { runPage, startPage } from "./shell.js";

function verdictFor(average) {
  if (average === null || average === undefined) return "Not rated yet";
  if (average >= 4.5) return "Excellent";
  if (average >= 3.5) return "Good";
  if (average >= 2.5) return "Average";
  if (average >= 1.5) return "Poor";
  return "Very poor";
}

function statCard(label, value, hint) {
  return el("div", { class: "stat" }, [
    el("span", { class: "stat__label", text: label }),
    el("span", { class: "stat__value", text: value }),
    hint ? el("span", { class: "stat__hint", text: hint }) : null,
  ]);
}

function renderTotals(overview) {
  const messAverage = overview.messAverageLastWeek;
  mount(
    document.querySelector("#totals"),
    statCard("Students signed up", String(overview.studentCount)),
    statCard(
      "Mess rating this week",
      messAverage === null ? "No ratings yet" : `${messAverage} / 5`,
      verdictFor(messAverage),
    ),
    statCard("Meal ratings logged", String(overview.messRatingCount)),
    statCard("Campus reviews", String(overview.reviewCount)),
    statCard("Complaints open", String(overview.openComplaintCount), `${overview.resolvedComplaintCount} resolved`),
  );
}

function mealCard(meal, labels) {
  const aggregate = meal.aggregate ?? meal;
  return el("div", { class: "stat" }, [
    el("h3", { text: labels[meal.meal] ?? meal.meal }),
    starRow(aggregate.averageStars, {
      verdict: verdictFor(aggregate.averageStars),
      count: aggregate.ratingCount,
    }),
  ]);
}

function renderTodayMeals(overview) {
  const labels = { breakfast: "Breakfast", lunch: "Lunch", snacks: "Evening snacks", dinner: "Dinner" };
  const container = document.querySelector("#today-meals");
  mount(container, ...overview.todayMeals.map((meal) => mealCard(meal, labels)));
}

function renderTrend(overview) {
  const container = document.querySelector("#trend");
  const rated = overview.messTrend.filter((point) => point.averageStars !== null);
  mount(
    container,
    ...overview.messTrend.map((point) => {
      const percent = point.averageStars === null ? 0 : (point.averageStars / 5) * 100;
      return el("div", { class: "trend__col" }, [
        el("span", {
          class: "trend__value",
          text: point.averageStars === null ? "–" : String(point.averageStars),
        }),
        el("div", {
          class: `trend__bar ${point.averageStars === null ? "trend__bar--empty " : ""}${fillClass(percent, "height")}`.trim(),
          attrs: {
            role: "img",
            "aria-label":
              point.averageStars === null
                ? `${formatDate(point.date)}: no ratings`
                : `${formatDate(point.date)}: ${point.averageStars} out of 5 from ${point.ratingCount} ratings`,
          },
        }),
        el("span", { class: "trend__label", text: formatDate(point.date).replace(",", "") }),
      ]);
    }),
  );
  document.querySelector("#trend-note").textContent =
    rated.length === 0
      ? "Nobody has rated a meal in the last seven days yet."
      : `${rated.length} of the last 7 days have ratings.`;
}

function renderSpread(overview) {
  const total = overview.starSpread.reduce((sum, bucket) => sum + bucket.count, 0);
  const container = document.querySelector("#spread");
  if (total === 0) {
    mount(container, el("p", { class: "empty-state", text: "No campus reviews yet. Be the first." }));
    return;
  }
  mount(
    container,
    ...[...overview.starSpread].reverse().map((bucket) => {
      const percent = (bucket.count / total) * 100;
      return el("div", { class: "spread-row" }, [
        el("span", { text: `${bucket.stars} star${bucket.stars === 1 ? "" : "s"}` }),
        bar(percent, bucket.stars >= 4 ? "success" : bucket.stars <= 2 ? "danger" : undefined),
        el("span", { text: String(bucket.count) }),
      ]);
    }),
  );
}

function renderCategories(overview) {
  const body = document.querySelector("#categories tbody");
  mount(
    body,
    ...overview.categoryScores.map((score) =>
      el("tr", {}, [
        el("th", { attrs: { scope: "row" } }, [
          el("a", { text: score.name, attrs: { href: `/reviews?category=${score.slug}` } }),
        ]),
        el("td", {}, [starRow(score.averageStars, { verdict: verdictFor(score.averageStars) })]),
        el("td", { text: String(score.reviewCount) }),
        el("td", {}, [
          score.openComplaints === 0
            ? el("span", { class: "muted", text: "none" })
            : el("span", { class: "chip chip--open", text: String(score.openComplaints) }),
        ]),
      ]),
    ),
  );
}

function activityLine(item) {
  const kindLabel = { review: "Review", complaint: "Complaint", mess: "Mess", notice: "Notice" };
  return el("li", { class: "entry" }, [
    el("div", { class: "entry__top" }, [
      el("h3", { class: "entry__title", text: item.title }),
      el("span", { class: "chip", text: kindLabel[item.kind] ?? item.kind }),
    ]),
    el("div", { class: "entry__meta" }, [
      el("span", { text: item.authorName }),
      el("span", { text: titleCaseStatus(item.detail) }),
      item.stars === null ? null : starRow(item.stars),
    ]),
  ]);
}

function renderActivity(overview) {
  const list = document.querySelector("#activity");
  if (overview.recentActivity.length === 0) {
    mount(list, el("li", { class: "empty-state", text: "Nothing posted yet." }));
    return;
  }
  mount(list, ...overview.recentActivity.map(activityLine));
}

runPage(async () => {
  await startPage();
  const overview = await get("/api/stats/overview");
  renderTotals(overview);
  renderTodayMeals(overview);
  renderTrend(overview);
  renderSpread(overview);
  renderCategories(overview);
  renderActivity(overview);
});
