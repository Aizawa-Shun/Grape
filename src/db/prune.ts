import "dotenv/config";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { lt } from "drizzle-orm";

import { databaseCredentials } from "./connection";
import { applyPragmas } from "./pragmas";
import * as schema from "./schema";

/**
 * Deletes events past the retention window.
 *
 * /api/collect prunes opportunistically on roughly one request in a thousand,
 * which is enough for a site with traffic. This exists for the case that is
 * not: a product that stopped receiving events still has old rows, and nothing
 * will ever come along to clear them.
 *
 * Wrapped in a function rather than using top-level await — tsx loads this as
 * CommonJS and a top-level await fails with ERR_REQUIRE_ASYNC_MODULE.
 */
async function main(): Promise<void> {
  const { url } = databaseCredentials();
  const days = Number(process.env.GRAPE_EVENT_RETENTION_DAYS ?? 180);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const client = createClient(databaseCredentials());
  try {
    await applyPragmas(client);
    const db = drizzle(client, { schema });
    const result = await db.delete(schema.events).where(lt(schema.events.ts, cutoff));
    console.log(
      `Deleted ${result.rowsAffected} event(s) older than ${cutoff.toISOString()} from ${url}`,
    );
  } finally {
    client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
