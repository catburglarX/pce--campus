/**
 * Decides where to send a user after sign-in.
 *
 * Only same-origin paths are accepted. Resolving against the current origin and comparing origins
 * catches every form of escape, including "/\evil.com", which browsers treat as "//evil.com" and a
 * simple prefix check would let through.
 *
 * @param {string} search   window.location.search
 * @param {string} origin   window.location.origin
 * @returns {string} a path on this origin, "/" when the request is missing or unsafe
 */
export function safeNextPath(search, origin) {
  const requested = new URLSearchParams(search).get("next");
  if (!requested || !requested.startsWith("/")) return "/";
  let target;
  try {
    target = new URL(requested, origin);
  } catch {
    return "/";
  }
  if (target.origin !== origin) return "/";
  return `${target.pathname}${target.search}${target.hash}`;
}
