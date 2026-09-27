/**
 * API client.
 *
 * One place attaches the CSRF token, one place decides what a failed response means, and one place
 * handles an expired session by sending the student back to the sign-in page. Callers get either data or
 * an ApiError carrying the message the server wrote for the student.
 */

let csrfToken = "";

export function setCsrfToken(token) {
  csrfToken = token ?? "";
}

export function getCsrfToken() {
  return csrfToken;
}

export class ApiError extends Error {
  constructor(message, status, field, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.field = field ?? null;
    this.code = code ?? "error";
  }
}

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

async function parseBody(response) {
  const text = await response.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("The server sent a response this page could not read.", response.status, null, "bad_json");
  }
}

/**
 * Sends a request and returns the parsed body.
 *
 * On 401 the page navigates to sign-in rather than showing a broken screen, because every page in this
 * app needs a session and there is nothing useful to render without one.
 */
export async function api(method, path, body) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (WRITE_METHODS.has(method) && csrfToken) headers["X-CSRF-Token"] = csrfToken;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch (networkError) {
    throw new ApiError(
      `Could not reach the server. Is it still running? (${networkError.message})`,
      0,
      null,
      "network",
    );
  }

  const payload = await parseBody(response);
  if (response.ok) return payload;

  if (response.status === 401 && !path.endsWith("/api/auth/me")) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.assign(`/login?next=${next}`);
    throw new ApiError("Your session ended. Sending you to sign in.", 401, null, "unauthenticated");
  }

  const error = payload.error ?? {};
  throw new ApiError(
    error.message ?? `Request failed with status ${response.status}.`,
    response.status,
    error.field,
    error.code,
  );
}

export const get = (path) => api("GET", path);
export const post = (path, body) => api("POST", path, body);
export const patch = (path, body) => api("PATCH", path, body);
export const put = (path, body) => api("PUT", path, body);
export const remove = (path) => api("DELETE", path);
