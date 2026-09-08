import type { Client } from "@libsql/client";

/**
 * Set explicitly rather than trusted to a driver default.
 *
 * - `foreign_keys`: /api/collect's rejection of events for an unknown product
 *   rests entirely on this constraint. Nothing else checks the id.
 * - `journal_mode=WAL` + `busy_timeout`: Next runs route handlers
 *   concurrently, so a diagnosis writing while a page reads is ordinary, and
 *   without these that pair is a SQLITE_BUSY away from failing.
 *
 * Kept in its own module, free of side effects, so the migration script can
 * apply the same settings without importing the app's connection.
 */
const PRAGMAS = [
  "PRAGMA foreign_keys = ON",
  "PRAGMA journal_mode = WAL",
  "PRAGMA busy_timeout = 5000",
];

export async function applyPragmas(client: Pick<Client, "execute">): Promise<void> {
  for (const pragma of PRAGMAS) await client.execute(pragma);
}
