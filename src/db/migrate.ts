import "dotenv/config";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import { databaseCredentials } from "./connection";
import { freshDatabaseWarning, migrationStatus, readJournal } from "./migration-status";
import { applyPragmas } from "./pragmas";

/**
 * Applies the SQL in ./drizzle to the configured database.
 *
 * We generate migrations with `drizzle-kit generate` (pure codegen, no driver)
 * and apply them here rather than using `drizzle-kit push`, because push's
 * sqlite dialect drives better-sqlite3 — which does not build on this machine.
 *
 * Wrapped in a function rather than using top-level await: tsx loads this as
 * CommonJS and a top-level await fails with ERR_REQUIRE_ASYNC_MODULE.
 */
async function main(): Promise<void> {
  const { url } = databaseCredentials();
  const client = createClient(databaseCredentials());
  try {
    // Same settings the app runs under, so a migration cannot succeed here
    // under looser rules than the ones its data will live by.
    await applyPragmas(client);

    // Read before migrating, because after it there is no longer any
    // difference between a database that has been here all along and one this
    // command just invented.
    const before = await migrationStatus(client, await readJournal());

    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    console.log(`Migrations applied to ${url}`);

    const warning = freshDatabaseWarning(before, url);
    if (warning) console.warn(`[grape] ${warning}`);
  } finally {
    client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
