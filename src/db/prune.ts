import "dotenv/config";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq, lt } from "drizzle-orm";

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

  const client = createClient(databaseCredentials());
  try {
    await applyPragmas(client);
    const db = drizzle(client, { schema });
    const days = await retentionDays(db);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await db.delete(schema.events).where(lt(schema.events.ts, cutoff));
    console.log(
      `Deleted ${result.rowsAffected} event(s) older than ${cutoff.toISOString()} from ${url}`,
    );
  } finally {
    client.close();
  }
}

/**
 * The same answer /api/collect's opportunistic prune gets from
 * currentSettings(): a value saved from /settings wins over .env, which wins
 * over the default. Read by hand rather than through core/settings, like the
 * rest of this script, which runs outside the app and its env schema — but it
 * must not read .env alone, or `pnpm db:prune` would quietly delete to a
 * window the owner already changed on the settings screen.
 */
async function retentionDays(db: ReturnType<typeof drizzle<typeof schema>>): Promise<number> {
  const [override] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, "GRAPE_EVENT_RETENTION_DAYS"));

  for (const candidate of [override?.value, process.env.GRAPE_EVENT_RETENTION_DAYS]) {
    const days = Number(candidate);
    if (Number.isInteger(days) && days > 0) return days;
  }
  return 180;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
