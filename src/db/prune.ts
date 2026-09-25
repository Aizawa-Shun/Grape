import "dotenv/config";

import { loadSettings } from "@/core/settings";
import { db } from "@/db/client";

/**
 * `pnpm db:prune` — deletes events past the retention window.
 *
 * /api/collect prunes opportunistically on roughly one request in a thousand,
 * which is enough for a site with traffic. This exists for the case that is
 * not: a product that stopped receiving events still has old ones, and
 * nothing will ever come along to clear them.
 *
 * Retention comes from loadSettings(), so a value saved from /settings wins
 * over the environment — the same answer the ingest route gets.
 *
 * Wrapped in a function rather than using top-level await — tsx loads this as
 * CommonJS and a top-level await fails with ERR_REQUIRE_ASYNC_MODULE.
 */
async function main(): Promise<void> {
  const settings = await loadSettings();
  const cutoff = new Date(Date.now() - settings.GRAPE_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await db.events.deleteWhere([["ts", "<", cutoff]]);
  console.log(`Deleted ${deleted} event(s) older than ${cutoff.toISOString()}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
