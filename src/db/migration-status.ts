import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Client } from "@libsql/client";

/**
 * Whether the database has had exactly the migrations this checkout ships.
 *
 * The health check previously asked "are there any tables at all?", which a
 * database three migrations behind passes happily — and a schema that is
 * silently behind shows up later as a confusing query error rather than as a
 * missing migration.
 *
 * Drizzle's libsql migrator records each applied migration's `created_at` as
 * the `when` field from the journal, so the two are comparable exactly, with
 * no hashing of our own.
 */

const MIGRATIONS_TABLE = "__drizzle_migrations";

export type MigrationStatus =
  | { ok: true; applied: number }
  | {
      ok: false;
      reason: "never_migrated" | "behind" | "ahead" | "diverged";
      applied: number;
      expected: number;
    };

interface JournalEntry {
  when: number;
  tag: string;
}

export async function readJournal(
  journalPath = path.join(process.cwd(), "drizzle", "meta", "_journal.json"),
): Promise<JournalEntry[]> {
  const raw = await readFile(journalPath, "utf8");
  return (JSON.parse(raw) as { entries?: JournalEntry[] }).entries ?? [];
}

export async function migrationStatus(
  client: Pick<Client, "execute">,
  entries: JournalEntry[],
): Promise<MigrationStatus> {
  const expected = entries.length;

  let applied: number;
  let lastApplied: number | null;
  try {
    const result = await client.execute(
      `select count(*) as n, max(created_at) as last from ${MIGRATIONS_TABLE}`,
    );
    applied = Number(result.rows[0]?.n ?? 0);
    lastApplied = result.rows[0]?.last == null ? null : Number(result.rows[0].last);
  } catch {
    // The table only exists once the migrator has run at least once.
    return { ok: false, reason: "never_migrated", applied: 0, expected };
  }

  if (applied === 0) return { ok: false, reason: "never_migrated", applied, expected };
  if (applied < expected) return { ok: false, reason: "behind", applied, expected };
  if (applied > expected) return { ok: false, reason: "ahead", applied, expected };

  // Same count but a different final timestamp means the files were rewritten
  // rather than added to — the case where "just run migrate" will not help.
  if (lastApplied !== entries[expected - 1]?.when) {
    return { ok: false, reason: "diverged", applied, expected };
  }

  return { ok: true, applied };
}

export function describeMigrationStatus(status: MigrationStatus): string {
  if (status.ok) return `${status.applied} migrations applied`;

  switch (status.reason) {
    case "never_migrated":
      return "database has never been migrated — run `pnpm db:migrate`";
    case "behind":
      return `database is ${status.expected - status.applied} migration(s) behind — run \`pnpm db:migrate\``;
    case "ahead":
      return `database has ${status.applied - status.expected} migration(s) this checkout does not ship — pull the latest code`;
    case "diverged":
      return "applied migrations do not match the ones in drizzle/ — restore a backup or recreate the database";
  }
}
