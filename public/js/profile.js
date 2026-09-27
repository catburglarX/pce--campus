/**
 * Account page: what the student has contributed, their details, and a password change that the server
 * treats as a reason to invalidate every other session.
 */

import { get, patch, post } from "./api.js";
import {
  clearAlert,
  clearFieldErrors,
  el,
  mount,
  showAlert,
  showFieldError,
  toast,
} from "./dom.js";
import { runPage, startPage } from "./shell.js";

function statCard(label, value, hint) {
  return el("div", { class: "stat" }, [
    el("span", { class: "stat__label", text: label }),
    el("span", { class: "stat__value", text: value }),
    hint ? el("span", { class: "stat__hint", text: hint }) : null,
  ]);
}

function renderActivity(payload) {
  const activity = payload.activity;
  mount(
    document.querySelector("#activity"),
    statCard("Campus reviews written", String(activity.reviewCount)),
    statCard("Meals rated", String(activity.messRatingCount)),
    statCard("Complaints raised", String(activity.complaintCount)),
    statCard("Times marked helpful", String(activity.helpfulReceived)),
    statCard(
      "Your average rating",
      activity.averageStarsGiven === null ? "No reviews yet" : `${activity.averageStarsGiven} / 5`,
    ),
  );
  document.querySelector("#session-count").textContent =
    `Active sessions on your account: ${payload.activeSessions}`;
}

function fillProfileForm(user) {
  document.querySelector("#email-display").value = user.email;
  document.querySelector("#name").value = user.name;
  document.querySelector("#branch").value = user.branch;
  document.querySelector("#studyYear").value = user.studyYear === null ? "" : String(user.studyYear);
  document.querySelector("#isHostelResident").checked = user.isHostelResident;
}

function wireProfileForm() {
  const form = document.querySelector("#profile-form");
  const alertBox = document.querySelector("#profile-alert");
  const submit = document.querySelector("#profile-submit");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAlert(alertBox);
    clearFieldErrors(form);
    submit.disabled = true;
    const data = new FormData(form);
    const yearValue = String(data.get("studyYear") ?? "");
    try {
      await patch("/api/auth/profile", {
        name: String(data.get("name") ?? "").trim(),
        branch: String(data.get("branch") ?? "").trim(),
        studyYear: yearValue === "" ? null : Number(yearValue),
        isHostelResident: data.get("isHostelResident") === "on",
      });
      showAlert(alertBox, "Saved.", "success");
      toast("Your details were saved.");
    } catch (error) {
      const placed = error.field ? showFieldError(form, error.field, error.message) : false;
      if (!placed) showAlert(alertBox, error.message);
    } finally {
      submit.disabled = false;
    }
  });
}

function wirePasswordForm() {
  const form = document.querySelector("#password-form");
  const alertBox = document.querySelector("#password-alert");
  const submit = document.querySelector("#password-submit");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAlert(alertBox);
    clearFieldErrors(form);
    submit.disabled = true;
    const data = new FormData(form);
    try {
      await post("/api/auth/password", {
        currentPassword: String(data.get("currentPassword") ?? ""),
        newPassword: String(data.get("newPassword") ?? ""),
      });
      form.reset();
      showAlert(alertBox, "Password changed. Other devices have been signed out.", "success");
      toast("Password changed.");
      const refreshed = await get("/api/auth/me");
      renderActivity(refreshed);
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
  fillProfileForm(session.user);
  renderActivity(session);
  wireProfileForm();
  wirePasswordForm();
});
