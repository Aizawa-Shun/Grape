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
 *
 * `journal_mode` and `busy_timeout` are a local-file concern: sqld, the
 * server a libsql:// URL talks to, owns its own storage engine and manages
 * concurrency itself, so it rejects both pragmas outright rather than
 * silently ignoring them. `foreign_keys` it does honor. So each pragma is
 * applied on its own and a rejection is swallowed — the two that matter only
 * for a local file simply have nothing to do against a remote database.
 */
const PRAGMAS = [
  "PRAGMA foreign_keys = ON",
  "PRAGMA journal_mode = WAL",
  "PRAGMA busy_timeout = 5000",
];

export async function applyPragmas(client: Pick<Client, "execute">): Promise<void> {
  for (const pragma of PRAGMAS) {
    try {
      await client.execute(pragma);
    } catch {
      // Not supported by this server — see the note above.
    }
  }
}
