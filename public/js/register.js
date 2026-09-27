/**
 * Registration page behaviour. Field errors from the server are placed next to the input they name so
 * the student can fix the specific problem instead of rereading the whole form.
 */

import { post } from "./api.js";
import { clearAlert, clearFieldErrors, showAlert, showFieldError } from "./dom.js";

function setup() {
  const form = document.querySelector("#register-form");
  const alertBox = document.querySelector("#alert");
  const submit = document.querySelector("#submit");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAlert(alertBox);
    clearFieldErrors(form);
    submit.disabled = true;
    submit.textContent = "Creating…";

    const data = new FormData(form);
    const yearValue = String(data.get("studyYear") ?? "");
    try {
      await post("/api/auth/register", {
        name: String(data.get("name") ?? "").trim(),
        email: String(data.get("email") ?? "").trim(),
        password: String(data.get("password") ?? ""),
        joinCode: String(data.get("joinCode") ?? "").trim(),
        branch: String(data.get("branch") ?? "").trim(),
        studyYear: yearValue === "" ? null : Number(yearValue),
        isHostelResident: data.get("isHostelResident") === "on",
      });
      window.location.assign("/");
    } catch (error) {
      const placed = error.field ? showFieldError(form, error.field, error.message) : false;
      if (!placed) showAlert(alertBox, error.message);
      submit.disabled = false;
      submit.textContent = "Create account";
    }
  });
}

window.addEventListener("DOMContentLoaded", setup);
