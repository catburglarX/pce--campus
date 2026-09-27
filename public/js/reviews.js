/**
 * Reviews page: the write form, the filter form, the result list and pagination.
 *
 * Filter state lives in the URL query string, so a filtered view can be shared or reloaded and the
 * browser back button behaves the way a student expects.
 */

import { get, post } from "./api.js";
import {
  clearAlert,
  clearFieldErrors,
  el,
  mount,
  readRadio,
  showAlert,
  showFieldError,
  starFieldset,
  toast,
} from "./dom.js";
import { renderReviewList } from "./review-card.js";
import { runPage, startPage } from "./shell.js";

const PAGE_SIZE = 10;
const context = { isAdmin: false, reload: async () => loadResults() };
let categories = [];

function currentFilters() {
  const parameters = new URLSearchParams(window.location.search);
  return {
    category: parameters.get("category") ?? "",
    sort: parameters.get("sort") ?? "recent",
    q: parameters.get("q") ?? "",
    mine: parameters.get("mine") === "1",
    page: Math.max(1, Number(parameters.get("page") ?? 1) || 1),
  };
}

function writeFiltersToUrl(filters) {
  const parameters = new URLSearchParams();
  if (filters.category) parameters.set("category", filters.category);
  if (filters.sort && filters.sort !== "recent") parameters.set("sort", filters.sort);
  if (filters.q) parameters.set("q", filters.q);
  if (filters.mine) parameters.set("mine", "1");
  if (filters.page > 1) parameters.set("page", String(filters.page));
  const query = parameters.toString();
  window.history.replaceState({}, "", query ? `/reviews?${query}` : "/reviews");
}

function fillCategorySelects() {
  const writeSelect = document.querySelector("#categoryId");
  const filterSelect = document.querySelector("#filter-category");
  for (const category of categories) {
    writeSelect.append(el("option", { text: category.name, attrs: { value: String(category.id) } }));
    filterSelect.append(el("option", { text: category.name, attrs: { value: category.slug } }));
  }
}

function applyFiltersToForm(filters) {
  document.querySelector("#filter-category").value = filters.category;
  document.querySelector("#filter-sort").value = filters.sort;
  document.querySelector("#filter-search").value = filters.q;
  document.querySelector("#filter-mine").checked = filters.mine;
}

function buildPagination(total, filters) {
  const container = document.querySelector("#pagination");
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (lastPage === 1) {
    mount(container);
    return;
  }
  const go = async (page) => {
    writeFiltersToUrl({ ...filters, page });
    await loadResults();
    document.querySelector("#results-heading").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  mount(
    container,
    el("button", {
      class: "btn btn--secondary btn--small",
      text: "Previous",
      attrs: { type: "button", disabled: filters.page <= 1 ? "" : null },
      on: { click: () => go(filters.page - 1) },
    }),
    el("span", { class: "caption", text: `Page ${filters.page} of ${lastPage}` }),
    el("button", {
      class: "btn btn--secondary btn--small",
      text: "Next",
      attrs: { type: "button", disabled: filters.page >= lastPage ? "" : null },
      on: { click: () => go(filters.page + 1) },
    }),
  );
}

async function loadResults() {
  const filters = currentFilters();
  applyFiltersToForm(filters);
  const list = document.querySelector("#results");
  mount(list, el("li", { class: "loading", text: "Loading reviews…" }));

  const parameters = new URLSearchParams({
    sort: filters.sort,
    page: String(filters.page),
    pageSize: String(PAGE_SIZE),
  });
  if (filters.category) parameters.set("category", filters.category);
  if (filters.q) parameters.set("q", filters.q);
  if (filters.mine) parameters.set("mine", "1");

  const payload = await get(`/api/reviews?${parameters.toString()}`);
  renderReviewList(list, payload.items, context);
  document.querySelector("#result-count").textContent =
    payload.total === 0 ? "No reviews yet" : `${payload.total} review${payload.total === 1 ? "" : "s"} found`;
  buildPagination(payload.total, filters);
}

function wireFilterForm() {
  const form = document.querySelector("#filter-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    writeFiltersToUrl({
      category: String(data.get("category") ?? ""),
      sort: String(data.get("sort") ?? "recent"),
      q: String(data.get("q") ?? "").trim(),
      mine: data.get("mine") === "on",
      page: 1,
    });
    try {
      await loadResults();
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

function wireWriteForm() {
  const form = document.querySelector("#write-form");
  const alertBox = document.querySelector("#write-alert");
  const submit = document.querySelector("#write-submit");
  document.querySelector("#stars-slot").append(starFieldset("stars", "Your rating out of 5"));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAlert(alertBox);
    clearFieldErrors(form);
    const stars = readRadio(form, "stars");
    if (stars === null) {
      document.querySelector("#stars-error").textContent = "Pick a rating out of 5.";
      return;
    }
    submit.disabled = true;
    const data = new FormData(form);
    try {
      await post("/api/reviews", {
        categoryId: Number(data.get("categoryId")),
        subject: String(data.get("subject") ?? "").trim(),
        title: String(data.get("title") ?? "").trim(),
        body: String(data.get("body") ?? "").trim(),
        stars,
        isAnonymous: data.get("isAnonymous") === "on",
      });
      form.reset();
      document.querySelector("#write-details").open = false;
      toast("Review posted. Thanks for writing it.");
      writeFiltersToUrl({ ...currentFilters(), page: 1 });
      await loadResults();
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
  wireFilterForm();
  wireWriteForm();
  await loadResults();
});
