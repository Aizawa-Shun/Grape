import "dotenv/config";

import { runLoopTick } from "@/core/loop/tick";
import { loadSettings } from "@/core/settings";

/**
 * `pnpm loop:tick` — one turn of the scheduled loop, by hand.
 *
 * The same thing POST /api/cron/tick does, for a machine that can run a
 * command on a timer (a crontab line on a machine with Firestore credentials)
 * rather than send an authenticated request. Prints the result as JSON and
 * exits non-zero only if something was attempted and failed.
 *
 * Wrapped in a function rather than using top-level await — tsx loads this as
 * CommonJS and a top-level await fails with ERR_REQUIRE_ASYNC_MODULE.
 */
async function main(): Promise<void> {
  // Settings saved from /settings (LLM_PROVIDER, the monthly budget) live in
  // the database; without this the run would see .env alone.
  await loadSettings();

  const result = await runLoopTick();
  console.log(JSON.stringify(result, null, 2));
  if (result.failed.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
