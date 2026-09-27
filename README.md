# PCE Campus Voice

[![CI](https://github.com/catburglarX/pce--campus/actions/workflows/ci.yml/badge.svg)](https://github.com/catburglarX/pce--campus/actions/workflows/ci.yml)
[![Release](https://github.com/catburglarX/pce--campus/actions/workflows/release.yml/badge.svg)](https://github.com/catburglarX/pce--campus/actions/workflows/release.yml)
[![CodeQL](https://github.com/catburglarX/pce--campus/actions/workflows/codeql.yml/badge.svg)](https://github.com/catburglarX/pce--campus/actions/workflows/codeql.yml)

A private review site for students of Poornima College of Engineering. Students sign in with a college
email and a join code, rate every mess meal on taste, hygiene and quantity, review any part of campus from
the hostel to the placement cell, raise complaints that an admin moves through a status workflow, and read
notices. It runs on one machine with no internet connection and no packages to install.

## Run it

Bun is the only thing needed, and it is not on PATH on this machine, so the full path is used below. Run
these from the project root, `C:\project\research\pce-campus`.

```powershell
$bun = "C:\Users\antra\AppData\Local\Kiro-Cli\bun.exe"

& $bun run src/db/seed.ts        # categories, weekly menu, and the first admin account
& $bun run src/db/seed-demo.ts   # optional sample content so the site is not empty
& $bun run src/server.ts         # starts on http://localhost:4173
```

Stop the server with Ctrl+C. If `bun` is on your PATH, `bun run start`, `bun run seed` and
`bun run seed:demo` do the same thing.

The base seed prints the admin email and a randomly generated admin password **once**. Save it when you
see it. No default password ships with the code. To choose your own instead, set `ADMIN_PASSWORD` before
the first seed:

```powershell
$env:ADMIN_PASSWORD = "a-phrase-you-will-remember"
& $bun run src/db/seed.ts
```

If you lose the admin password, delete the database and seed again: `& $bun run src/db/reset.ts --yes`.
That deletes every account and every review, so it refuses to run without `--yes`.

## Signing in

Students register themselves at `/register`. Registration needs two things, which together are what make
the site private:

- an email ending in `poornima.org` or `poornima.edu.in`
- the join code, `PCE-CAMPUS-2026` unless you change it

Change the join code by setting `JOIN_CODE` before starting the server. Share it in class groups, not
publicly. An admin can see the current code on the admin page.

If you ran the demo seed, six sample students exist, for example `aarti.gupta@poornima.org`, and they all
share the password printed by that seeder. Delete the database before real students use the site, because
shared sample passwords are fine for a laptop and wrong for anything else.

## What it does

Mess food. A weekly menu of four meals a day, which only an admin can edit. Any student rates a meal for a
given day on overall stars plus taste, hygiene and quantity, with an optional comment. One rating per
student per meal per day, enforced by the database, so a second submission replaces the first rather than
moving the average twice. Ratings are open for today and the previous seven days, never for a future meal.

Campus reviews. Fourteen areas: mess food, canteen, hostel, classrooms and labs, faculty, library, WiFi
and IT, transport, sports, fests, washrooms, medical, placement, admin office. Star rating, title, body,
an optional subject such as "Hostel block C", and an optional anonymous flag. Other students can mark a
review helpful, reply to it, or report it to an admin. Only the author can edit their own words.

Complaints. Separate from reviews, because a complaint is a thing that needs fixing. It carries a location,
an urgency, and a status an admin moves through open, in progress, resolved or rejected. Closing one
requires a note that the student will read. Other students add "same problem here" so the count shows how
many people it affects. The author can withdraw it while it is still open.

Notices. An admin publishes announcements and can pin one to the top.

Dashboard. Totals, today's meals, the seven day mess trend, how ratings are spread across one to five
stars, a score for every campus area, and recent activity.

Admin. A queue of reported reviews with the reasons given, hide and restore with a reason the author sees,
the student roster with role and deactivation controls, and a log of every moderation action taken.

## Configuration

Every setting is an environment variable read once at startup. All are optional.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `4173` | Port to listen on. `0` asks the operating system for a free one. |
| `HOST` | `127.0.0.1` | Interface to bind. Localhost only by default, which is deliberate. |
| `DATABASE_PATH` | `data/campus-voice.sqlite` | Where the data lives. |
| `JOIN_CODE` | `PCE-CAMPUS-2026` | Code a student must present to register. |
| `ALLOWED_EMAIL_DOMAINS` | `poornima.org,poornima.edu.in` | Comma separated. A single `*` allows any domain. |
| `ADMIN_EMAIL` | `admin@poornima.org` | Email for the seeded admin. |
| `ADMIN_PASSWORD` | generated | Admin password. Generated and printed once if unset. |
| `SESSION_LIFETIME_HOURS` | `336` | How long a sign-in lasts. |
| `LOGIN_MAX_ATTEMPTS` | `8` | Failed sign-ins per email before throttling. |
| `LOGIN_WINDOW_MINUTES` | `15` | Length of the throttle window. |
| `MESS_RATING_BACKDATE_DAYS` | `7` | How far back a meal can still be rated. |
| `APP_ORIGIN` | `http://localhost:PORT` | Used to decide whether the session cookie gets `Secure`. |
| `TRUST_PROXY_HEADER` | `false` | Only set this when a reverse proxy you control rewrites `X-Forwarded-For`. |

## Verify it

```powershell
& $bun test                      # 105 tests
& $bun x tsc --noEmit            # type check, needs the dev dependencies installed
& $bun run scripts/smoke.ts      # starts a real server on a free port and drives every feature over HTTP
```

The smoke check uses its own throwaway database and deletes it afterwards, so it never touches your data.
It reads the port from the server it started, so a stray server on another port cannot confuse it.

The type check needs `typescript` and `@types/bun`, which are dev dependencies and the only packages this
project has. The application itself runs with nothing installed: server, SQLite, password hashing and the
test runner all come from Bun.

## How privacy actually works here

Posting anonymously hides your name from other students. It does not hide you from the database or from an
admin, because every row keeps its author so that abuse can be moderated. The interface says this where you
tick the box, and you should assume an admin can tell who wrote what. If you need real anonymity from the
college, this is not the tool.

Passwords are stored as Argon2id hashes at the parameters OWASP publishes, never in readable form. Session
cookies hold a random token and the database keeps only its SHA-256, so a copy of the database file does not
hand anyone a live login. Changing your password signs out every other device.

## Security limits you should know about

These are all fine for a site running on your own laptop and wrong for the public internet.

1. It serves plain HTTP. The session cookie only gets the `Secure` flag when `APP_ORIGIN` is an https URL.
   Putting this on a network without TLS in front of it would put session cookies on the wire.
2. Login throttling is counted in the server's memory, so restarting the server clears the counters.
3. There is no email server, so there is no self-service password reset. An admin resets an account by
   deactivating it, or you delete the database and start again. This is the one deliberate feature gap.
4. It binds `127.0.0.1` by default. Changing `HOST` to `0.0.0.0` exposes it to your whole network, which
   also means anyone on that network can reach the sign-in page and try the join code.
5. The join code is a shared secret. Anyone who has it and a college email address can register.

## Project layout

```
src/
  config.ts          every environment variable, read once
  server.ts          request pipeline and startup
  router.ts          method and path matching
  http.ts            responses, cookies, body limits, security headers
  errors.ts          error vocabulary and the status each deserves
  validate.ts        input validation at the edge
  ratelimit.ts       login throttling
  static-files.ts    asset serving with a path traversal guard
  db/                schema.sql, connection, seed, demo seed, reset
  domain/            pure decisions: calendar, rating maths, access rules, password policy
  services/          database access and business operations
  routes/            one file per area of the API, plus page gating
public/              nine HTML pages, two stylesheets, ES modules, no build step
tests/               eight suites
scripts/smoke.ts     end to end check over real HTTP
docs/adr/            the architecture decision and the argument against it
.github/workflows/    CI, release packaging and CodeQL
```

Pages are gated on the server. A signed-out browser is redirected before any HTML is written, and a student
asking for `/admin` is refused there as well as at every admin endpoint.

## Known gaps

No password reset by email, as explained above. No file or photo uploads, so a complaint cannot carry a
picture of the broken tap. No notification when a complaint you raised changes status, you check the board.
No export of the data to a spreadsheet. Nothing is translated into Hindi. None of these are started, and
none of them are needed for the site to be useful.

## Requirements and versions

Built and verified against Bun 1.3.13, then re-verified against Bun 1.4.2 after the runtime updated
itself. Any Bun from 1.3 should work. Nothing else is required to run it.
