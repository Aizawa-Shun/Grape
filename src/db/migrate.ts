import "dotenv/config";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

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
  const url = process.env.DATABASE_URL ?? "file:./grape.db";
  const client = createClient({ url });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    console.log(`Migrations applied to ${url}`);
  } finally {
    client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
