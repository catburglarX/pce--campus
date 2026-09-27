/**
 * DOM building helpers.
 *
 * Nothing in this app assigns innerHTML. Text always arrives as a text node, which is what makes a
 * review body containing <script> render as the characters a student typed rather than as markup. Any
 * future edit that reaches for innerHTML reintroduces a cross-site scripting hole.
 */

/**
 * Creates an element.
 *
 * @param {string} tag
 * @param {Object} [options] class, text, attrs, dataset and on (event map)
 * @param {Array} [children] elements or strings, strings become text nodes
 */
export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined && options.text !== null) node.textContent = String(options.text);
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, String(value));
  }
  for (const [name, value] of Object.entries(options.dataset ?? {})) {
    node.dataset[name] = String(value);
  }
  for (const [eventName, handler] of Object.entries(options.on ?? {})) {
    node.addEventListener(eventName, handler);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(node, ...children) {
  clear(node);
  for (const child of children) {
    if (child) node.append(child);
  }
  return node;
}

/** Rounds to the nearest five so the value maps onto a fill utility class. */
export function fillClass(percent, prefix = "fill") {
  const clamped = Math.max(0, Math.min(100, Math.round(percent / 5) * 5));
  return `${prefix}-${clamped}`;
}

const STAR_ON = "\u2605";
const STAR_OFF = "\u2606";

/** A star row plus a text score, because colour and shape alone are not an accessible signal. */
export function starRow(score, options = {}) {
  const rounded = Math.round(score ?? 0);
  const row = el("span", { class: "stars", attrs: { "aria-hidden": "true" } });
  for (let position = 1; position <= 5; position += 1) {
    row.append(
      el("span", {
        class: position <= rounded ? "stars__on" : "stars__off",
        text: position <= rounded ? STAR_ON : STAR_OFF,
      }),
    );
  }
  const label = score === null || score === undefined ? "Not rated yet" : `${score} out of 5`;
  return el("span", { class: "score-line" }, [
    row,
    el("span", { class: "score-line__number", text: score === null || score === undefined ? "–" : String(score) }),
    el("span", { class: "visually-hidden", text: label }),
    options.verdict ? el("span", { class: "score-line__verdict", text: options.verdict }) : null,
    options.count === undefined
      ? null
      : el("span", {
          class: "score-line__verdict",
          text: options.count === 1 ? "1 rating" : `${options.count} ratings`,
        }),
  ]);
}

export function chip(text, variant) {
  return el("span", { class: variant ? `chip chip--${variant}` : "chip", text });
}

export function bar(percent, variant) {
  const fill = el("span", {
    class: `bar__fill ${variant ? `bar__fill--${variant} ` : ""}${fillClass(percent)}`.trim(),
  });
  return el("span", { class: "bar" }, [fill]);
}

/** A field wrapper with a label, optional hint and an error slot wired up for screen readers. */
export function field(id, labelText, control, hintText) {
  const parts = [el("label", { class: "field__label", text: labelText, attrs: { for: id } })];
  if (hintText) parts.push(el("span", { class: "field__hint", attrs: { id: `${id}-hint` }, text: hintText }));
  if (hintText) control.setAttribute("aria-describedby", `${id}-hint`);
  parts.push(control);
  parts.push(el("span", { class: "field__error", attrs: { id: `${id}-error`, role: "alert" } }));
  return el("div", { class: "field" }, parts);
}

export function starFieldset(name, legendText, selected) {
  const options = el("div", { class: "star-input__options" });
  for (let value = 1; value <= 5; value += 1) {
    const input = el("input", {
      attrs: { type: "radio", name, value: String(value), id: `${name}-${value}` },
    });
    if (selected === value) input.checked = true;
    options.append(
      el("label", { class: "star-input__option", attrs: { for: `${name}-${value}` } }, [
        input,
        `${value}`,
        el("span", { class: "visually-hidden", text: `${value} star${value === 1 ? "" : "s"}` }),
      ]),
    );
  }
  return el("fieldset", { class: "star-input" }, [el("legend", { text: legendText }), options]);
}

export function readRadio(form, name) {
  const checked = form.querySelector(`input[name="${name}"]:checked`);
  return checked ? Number(checked.value) : null;
}

let toastRegion = null;

function ensureToastRegion() {
  if (toastRegion && document.body.contains(toastRegion)) return toastRegion;
  toastRegion = el("div", { class: "toast-region", attrs: { role: "status", "aria-live": "polite" } });
  document.body.append(toastRegion);
  return toastRegion;
}

/** Announces a short message. role="status" means a screen reader reads it without stealing focus. */
export function toast(message, variant = "success") {
  const region = ensureToastRegion();
  const item = el("div", { class: `toast toast--${variant}`, text: message });
  region.append(item);
  window.setTimeout(() => item.remove(), variant === "error" ? 6000 : 3500);
}

export function showAlert(node, message, variant = "error") {
  node.className = `form-alert form-alert--${variant}`;
  node.textContent = message;
}

export function clearAlert(node) {
  node.className = "form-alert";
  node.textContent = "";
}

/** Puts a field-level error next to the input the server complained about. */
export function showFieldError(form, field_, message) {
  const input = form.querySelector(`[name="${field_}"]`);
  const slot = input ? form.querySelector(`#${input.id}-error`) : null;
  if (input) input.setAttribute("aria-invalid", "true");
  if (slot) slot.textContent = message;
  return Boolean(slot);
}

export function clearFieldErrors(form) {
  for (const slot of form.querySelectorAll(".field__error")) slot.textContent = "";
  for (const input of form.querySelectorAll("[aria-invalid]")) input.removeAttribute("aria-invalid");
}

export function formatDateTime(isoText) {
  const when = new Date(isoText);
  if (Number.isNaN(when.getTime())) return isoText;
  return when.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(isoText) {
  const when = new Date(`${isoText}T00:00:00`);
  if (Number.isNaN(when.getTime())) return isoText;
  return when.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
}

export function titleCaseStatus(status) {
  return String(status).replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase());
}
