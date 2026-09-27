-- PCE Campus Voice schema.
-- Invariants live here as CHECK, UNIQUE and FOREIGN KEY constraints so a bug in a route cannot write a
-- row that breaks them. Timestamps are ISO 8601 strings in UTC; dates are plain YYYY-MM-DD in the
-- college's local day, because a meal belongs to a calendar day rather than an instant.

CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER NOT NULL PRIMARY KEY,
  applied_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  email                TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name                 TEXT    NOT NULL,
  password_hash        TEXT    NOT NULL,
  role                 TEXT    NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  branch               TEXT    NOT NULL DEFAULT '',
  study_year           INTEGER CHECK (study_year IS NULL OR study_year BETWEEN 1 AND 5),
  is_hostel_resident   INTEGER NOT NULL DEFAULT 0 CHECK (is_hostel_resident IN (0, 1)),
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at           TEXT    NOT NULL,
  password_changed_at  TEXT    NOT NULL
);

-- Sessions store the SHA-256 of the cookie token, never the token, so a copy of this file does not
-- grant anyone a live login.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT    NOT NULL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   TEXT    NOT NULL,
  user_agent   TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  icon        TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mess_menu (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  weekday    INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  meal       TEXT    NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'snacks', 'dinner')),
  items      TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  UNIQUE (weekday, meal)
);

-- One rating per student per meal per served day. The UNIQUE constraint is what makes the rate action
-- an upsert instead of a way to stuff the average.
CREATE TABLE IF NOT EXISTS mess_ratings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  served_on     TEXT    NOT NULL,
  meal          TEXT    NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'snacks', 'dinner')),
  stars         INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  taste         INTEGER CHECK (taste IS NULL OR taste BETWEEN 1 AND 5),
  hygiene       INTEGER CHECK (hygiene IS NULL OR hygiene BETWEEN 1 AND 5),
  quantity      INTEGER CHECK (quantity IS NULL OR quantity BETWEEN 1 AND 5),
  comment       TEXT    NOT NULL DEFAULT '',
  is_anonymous  INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0, 1)),
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  UNIQUE (user_id, served_on, meal)
);
CREATE INDEX IF NOT EXISTS idx_mess_ratings_day ON mess_ratings(served_on, meal);

CREATE TABLE IF NOT EXISTS reviews (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id    INTEGER NOT NULL REFERENCES categories(id),
  subject        TEXT    NOT NULL DEFAULT '',
  title          TEXT    NOT NULL,
  body           TEXT    NOT NULL,
  stars          INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  is_anonymous   INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0, 1)),
  status         TEXT    NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden')),
  hidden_reason  TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_category ON reviews(category_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_author ON reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);

CREATE TABLE IF NOT EXISTS review_votes (
  review_id  INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  PRIMARY KEY (review_id, user_id)
);

CREATE TABLE IF NOT EXISTS review_flags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id  INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  UNIQUE (review_id, user_id)
);

CREATE TABLE IF NOT EXISTS review_comments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id     INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT    NOT NULL,
  is_anonymous  INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0, 1)),
  created_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_review ON review_comments(review_id, created_at);

CREATE TABLE IF NOT EXISTS complaints (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id      INTEGER NOT NULL REFERENCES categories(id),
  title            TEXT    NOT NULL,
  body             TEXT    NOT NULL,
  location         TEXT    NOT NULL DEFAULT '',
  severity         TEXT    NOT NULL DEFAULT 'normal' CHECK (severity IN ('low', 'normal', 'high')),
  status           TEXT    NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'in_progress', 'resolved', 'rejected')),
  resolution_note  TEXT    NOT NULL DEFAULT '',
  resolved_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_anonymous     INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0, 1)),
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status, created_at DESC);

CREATE TABLE IF NOT EXISTS complaint_votes (
  complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT    NOT NULL,
  PRIMARY KEY (complaint_id, user_id)
);

CREATE TABLE IF NOT EXISTS notices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL,
  body       TEXT    NOT NULL,
  is_pinned  INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notices_pinned ON notices(is_pinned DESC, created_at DESC);

-- Every moderation action is recorded, so hiding a review or resolving a complaint is answerable.
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT    NOT NULL,
  target_type TEXT    NOT NULL,
  target_id   INTEGER,
  detail      TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
