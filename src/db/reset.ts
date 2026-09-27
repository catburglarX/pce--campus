/**
 * Deletes the database file so the site starts empty.
 *
 * This destroys every account, review, rating and complaint, so it refuses to run without --yes. A
 * mistyped script name should not be able to wipe a term of student feedback.
 */

import { existsSync, rmSync } from "node:fs";

import { config } from "../config";

function main(): void {
  if (!process.argv.includes("--yes")) {
    console.log("This deletes every account and every review in:");
    console.log(`  ${config.databasePath}`);
    console.log("");
    console.log("Run it again with --yes if that is what you want:");
    console.log("  bun run reset --yes");
    process.exitCode = 1;
    return;
  }

  let removed = 0;
  for (const suffix of ["", "-shm", "-wal"]) {
    const file = `${config.databasePath}${suffix}`;
    if (!existsSync(file)) continue;
    rmSync(file, { force: true });
    removed += 1;
  }
  console.log(removed === 0 ? "Nothing to delete." : `Deleted ${removed} database file(s).`);
  console.log("Run `bun run seed` to create the categories, the menu and a fresh admin.");
}

main();
