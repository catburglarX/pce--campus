/**
 * Sign-in page behaviour.
 *
 * The "next" parameter is checked to be a local path before it is used, so a link like
 * /login?next=https://example.com cannot turn this form into an open redirect.
 */

import { post } from "./api.js";
import { clearAlert, clearFieldErrors, showAlert, showFieldError } from "./dom.js";
import { safeNextPath } from "./redirect.js";

function setup() {
  const form = document.querySelector("#login-form");
  const alertBox = document.querySelector("#alert");
  const submit = document.querySelector("#submit");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearAlert(alertBox);
    clearFieldErrors(form);
    submit.disabled = true;
    submit.textContent = "Signing in…";

    const data = new FormData(form);
    try {
      await post("/api/auth/login", {
        email: String(data.get("email") ?? "").trim(),
        password: String(data.get("password") ?? ""),
      });
      window.location.assign(safeNextPath(window.location.search, window.location.origin));
    } catch (error) {
      const placed = error.field ? showFieldError(form, error.field, error.message) : false;
      if (!placed) showAlert(alertBox, error.message);
      submit.disabled = false;
      submit.textContent = "Sign in";
    }
  });
}

window.addEventListener("DOMContentLoaded", setup);
