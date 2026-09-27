/**
 * Mess page orchestration: which day is on screen, the weekly menu table, and admin menu editing.
 *
 * The per-meal rating card lives in mess-meal-card.js.
 */

import { get, put } from "./api.js";
import { clear, el, mount, toast } from "./dom.js";
import { buildMealCard } from "./mess-meal-card.js";
import { runPage, startPage } from "./shell.js";

const context = { date: "", labels: {}, isAdmin: false, reload: async () => reloadDay(context.date) };

function shiftDate(dateText, days) {
  const base = new Date(`${dateText}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

async function reloadDay(date) {
  context.date = date;
  document.querySelector("#date").value = date;
  const container = document.querySelector("#meals");
  mount(container, el("p", { class: "loading", text: "Loading the day…" }));
  const snapshot = await get(`/api/mess/day?date=${date}`);
  context.labels = snapshot.mealLabels ?? context.labels;
  mount(container, ...snapshot.meals.map((meal) => buildMealCard(meal, snapshot.canRate, context)));
  document.querySelector("#day-status").textContent = snapshot.isToday
    ? `Showing today, ${snapshot.weekdayName}.`
    : `Showing ${snapshot.weekdayName} ${date}.${snapshot.canRate ? "" : " Rating is closed for this day."}`;
  await renderWeek();
}

function startEditingCell(cell, staticText, editButton, day, meal) {
  const input = el("input", {
    attrs: { type: "text", "aria-label": `${day.weekdayName} ${meal.label} menu`, maxlength: "400" },
  });
  input.value = meal.items;

  const save = el("button", { class: "btn btn--small", text: "Save", attrs: { type: "button" } });
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      await put("/api/mess/menu", { weekday: day.weekday, meal: meal.meal, items: input.value.trim() });
      toast("Menu updated.");
      await reloadDay(context.date);
    } catch (error) {
      toast(error.message, "error");
      save.disabled = false;
    }
  });

  const cancel = el("button", {
    class: "btn btn--secondary btn--small",
    text: "Cancel",
    attrs: { type: "button" },
    on: {
      click: () => {
        clear(cell);
        cell.append(staticText, document.createTextNode(" "), editButton);
        editButton.focus();
      },
    },
  });

  clear(cell);
  cell.append(input, el("div", { class: "btn-row" }, [save, cancel]));
  input.focus();
}

function menuCell(day, meal) {
  const cell = el("td");
  const staticText = el("span", { text: meal.items || "Not published" });
  cell.append(staticText);
  if (!context.isAdmin) return cell;

  const editButton = el("button", {
    class: "btn btn--ghost btn--small",
    text: "Edit",
    attrs: { type: "button" },
  });
  editButton.addEventListener("click", () => startEditingCell(cell, staticText, editButton, day, meal));
  cell.append(document.createTextNode(" "), editButton);
  return cell;
}

async function renderWeek() {
  const week = await get("/api/mess/week");
  const shownWeekday = new Date(`${context.date}T00:00:00Z`).getUTCDay();
  mount(
    document.querySelector("#week tbody"),
    ...week.days.map((day) => {
      const row = el("tr", { class: day.weekday === shownWeekday ? "menu-day--today" : "" });
      row.append(el("th", { attrs: { scope: "row" }, text: day.weekdayName }));
      for (const meal of day.meals) row.append(menuCell(day, meal));
      return row;
    }),
  );
  document.querySelector("#week-note").textContent = context.isAdmin
    ? "You are an admin, so every cell has an edit button."
    : "Only a campus admin can change the menu.";
}

async function step(days) {
  try {
    await reloadDay(shiftDate(context.date, days));
  } catch (error) {
    toast(error.message, "error");
  }
}

function wireDayControls() {
  const dateInput = document.querySelector("#date");
  dateInput.addEventListener("change", async () => {
    if (!dateInput.value) return;
    try {
      await reloadDay(dateInput.value);
    } catch (error) {
      toast(error.message, "error");
    }
  });
  document.querySelector("#previous-day").addEventListener("click", () => step(-1));
  document.querySelector("#next-day").addEventListener("click", () => step(1));
  document.querySelector("#today-button").addEventListener("click", async () => {
    try {
      const snapshot = await get("/api/mess/day");
      await reloadDay(snapshot.date);
    } catch (error) {
      toast(error.message, "error");
    }
  });
}

runPage(async () => {
  const session = await startPage();
  context.isAdmin = session.user.role === "admin";
  const requested = new URLSearchParams(window.location.search).get("date");
  const snapshot = await get(requested ? `/api/mess/day?date=${requested}` : "/api/mess/day");
  context.labels = snapshot.mealLabels;
  await reloadDay(snapshot.date);
  wireDayControls();
});
