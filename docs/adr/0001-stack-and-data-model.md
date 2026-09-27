# ADR 0001: Runtime, storage and rendering for PCE Campus Voice

- Date: 2026-09-22
- Status: accepted
- Reversibility: runtime and rendering are cheap to reverse (days). The SQLite schema is medium cost to
  reverse once real student data exists, because it needs a migration rather than a rewrite.

## Context

A student at Poornima College of Engineering wants a private site where students sign in and review mess
food and the rest of campus life. It has to run on localhost on this machine and every feature has to
work, not appear to work.

Facts verified on this machine on 2026-09-22, not recalled:

| Fact | How it was checked | Result |
|---|---|---|
| Node.js present | `node --version`, `npm --version` | absent, not on PATH, no install directory found |
| Python present | `python --version`, `py --version` | absent, only the Microsoft Store alias stub |
| .NET, Java, Go, PHP, Ruby, Deno, Cargo | `Get-Command` probe for each | all absent |
| Bun present | `bun --version` | 1.3.13 at `C:\Users\antra\AppData\Local\Kiro-Cli\bun.exe` |
| SQLite built into Bun | script using `bun:sqlite`, create table, insert, select | worked, returned `ok` |
| Argon2id hashing built in | `Bun.password.hash` then `verify` with right and wrong password | `true` then `false` |
| HTTP server built in | `Bun.serve` on an ephemeral port, then `fetch` | HTTP 200 |
| Test runner built in | `bun test` on a one-line test file | `1 pass, 0 fail` |
| git present | `git --version` | 2.55.0.windows.3 |

The deciding fact is that the only runtime on the machine is Bun, and Bun already contains the four
things this project needs: a server, a database driver, a password hash and a test runner.

## Decision

Build it as a Bun application with **zero external dependencies**: `Bun.serve` for HTTP, `bun:sqlite`
for storage, `Bun.password` (argon2id) for credentials, `bun test` for tests, and a server-gated
multi-page frontend of plain HTML, CSS and ES modules with no build step.

Authentication is a server-side session with an opaque token in an HttpOnly cookie, which is the
`auth-implement` default for a first-party browser app. The cookie holds a random token; the database
stores only its SHA-256 hash, so reading the database file does not hand over live sessions.

## Options considered

**Option A, static site with browser storage and no server.** Nothing to run, nothing to break.
Rejected because reviews would live in one browser and never be seen by another student, which removes
the entire point of a shared review site.

**Option B, install Node.js through winget and build on Express plus React.** The mainstream stack most
teams would pick. Rejected because it adds a package install over the network, a native module build for
any SQLite driver, and a bundler step, on a machine that currently has no JavaScript package manager at
all. Each of those is a way for "run it on localhost" to fail, and the requirement here was explicitly
that nothing fails.

**Option C, Bun with a JSON API and a client-rendered single page app.** One runtime, no install, rich
interactivity. Partly adopted: the API is JSON, but not as a single page app, because one uncaught client
error in a single page app blanks the whole screen.

**Option D, chosen, Bun with server-gated pages plus a JSON API.** Each page is real HTML that the server
refuses to serve without a session, and each page loads one small ES module that talks to the API. A
broken script degrades one panel instead of the site, and the authentication gate happens before any HTML
reaches the browser, so there is no flash of logged-in content.

## The case against the chosen option

Bun is a young runtime compared with Node.js, and its standard library is the project's single point of
dependency. If Bun's SQLite or password API changes shape in a future major version, there is no
abstraction layer here to absorb it. The mitigation is that all database access is confined to
`src/services/` and all hashing to `src/services/users.ts`, so the blast radius of such a change is a
handful of files, but the honest position is that this trades ecosystem maturity for a guaranteed
zero-install run.

Second, writing the frontend without a framework means state synchronisation is manual. Pages re-fetch
after a mutation rather than patching a client-side store. That is more network chatter than a framework
would need, and on localhost it is irrelevant, but it would need revisiting if this were ever hosted.

Third, plain DOM construction invites cross-site scripting if any future edit writes user text through
`innerHTML`. The rule adopted instead is that all user-supplied text reaches the page through
`textContent` or `document.createTextNode` only. This is a discipline, not a compiler guarantee, which is
weaker than what a templating framework with automatic escaping would give.

## Consequences

Good: one command starts everything, `bun run start`. No network needed after the code exists. No
lockfile drift, no advisory surface from third-party packages, so `dependency-guard` has nothing to audit.
SQLite in WAL mode handles a few hundred students on one machine without tuning.

Bad: no horizontal scaling, because the database is a file next to the server. No email delivery, so
password reset cannot be a mailed link and is instead an admin-issued reset. Sessions live in the
database, so a corrupted database file logs everyone out.

Accepted limits, stated rather than hidden: the server listens on HTTP, so the session cookie carries
`Secure` only when `APP_ORIGIN` is https. Login rate limiting is in process memory and resets when the
server restarts. Both are acceptable for a localhost deployment and both are wrong for the public
internet; the README says so.

## What would reverse this

Hosting it for the whole college on a shared server would reverse the storage choice, since SQLite on one
box becomes the bottleneck and the single point of failure. Needing emailed password resets or college
single sign-on would reverse the credential choice, and `auth-implement` says to delegate to the identity
provider rather than keep a local password store once one exists.

## Addendum, 2026-09-23

The decision above is unchanged. Three things happened after it was recorded and are worth the next
reader knowing.

**The runtime updated itself.** Bun went from 1.3.13 to 1.4.2 between working sessions. The full suite was
re-run on 1.4.2: 97 tests pass, the type check is clean, and the end to end check passes. The single point
of dependency named in the case against this decision is therefore real but so far benign, and the project
has now been verified on two Bun versions rather than one.

**Two dev dependencies were added, and the zero dependency claim needs the qualifier.** `typescript` and
`@types/bun` are pinned in `devDependencies` so `tsc --noEmit` can run. The application still runs with
nothing installed, so the zero install property holds for running the site. It no longer holds for type
checking it. This was worth the trade because the first type check found nine real errors, including one
class of mistake, passing an object where a numeric id was expected, that had already caused a live bug
during the build.

**An independent audit found no blockers.** Two reviewers audited the code without sharing the build
context, one for security and correctness and one for the frontend and accessibility. Both returned no
blocking findings. Two lower severity items were raised and both are fixed: the end to end script used a
hardcoded port and could talk to an unrelated server, and the rate limiter believed a client supplied
`X-Forwarded-For` header. The port is now assigned by the operating system and read back from the spawned
server's own output, and the header is ignored unless `TRUST_PROXY_HEADER` is set.
