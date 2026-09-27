/**
 * SQLite connection handling.
 *
 * The handle is module level and swappable rather than passed through every service signature. Tests
 * call useDatabase() with a temporary file, the server calls it once with the configured path, and
 * services ask for it at call time.
 */

import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { config } from "../config";

let activeDatabase: Database | null = null;

function applyPragmas(db: Database): void {
  // WAL lets reads continue during a write, which matters because every page load reads while someone
  // is posting a review. busy_timeout stops a concurrent write from failing outright.
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA synchronous = NORMAL");
}

function applySchema(db: Database): void {
  const schemaPath = join(import.meta.dir, "schema.sql");
  const schemaSql = readFileSync(schemaPath, "utf8");
  db.run(schemaSql);
  const existing = db.query<{ version: number }, []>("SELECT MAX(version) AS version FROM schema_version").get();
  if (existing?.version == null) {
    db.run("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)", [1, new Date().toISOString()]);
  }
}

export function openDatabase(databasePath: string): Database {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  const db = new Database(databasePath, { create: true });
  applyPragmas(db);
  applySchema(db);
  return db;
}

/** Point the application at a database file. Called once by the server, and by tests per suite. */
export function useDatabase(databasePath: string): Database {
  closeDatabase();
  activeDatabase = openDatabase(databasePath);
  return activeDatabase;
}

export function getDb(): Database {
  if (!activeDatabase) {
    activeDatabase = openDatabase(config.databasePath);
  }
  return activeDatabase;
}

export function closeDatabase(): void {
  if (activeDatabase) {
    activeDatabase.close();
    activeDatabase = null;
  }
}
