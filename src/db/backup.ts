import "dotenv/config";

import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";

import { databaseCredentials } from "./connection";

/**
 * A consistent snapshot without stopping the server.
 *
 * VACUUM INTO rather than copying the file: under WAL a plain copy can catch
 * the database mid-write and miss whatever is still in the -wal file, which
 * produces a backup that looks fine until the day it is needed.
 *
 * Wrapped in a function rather than using top-level await — tsx loads this as
 * CommonJS and a top-level await fails with ERR_REQUIRE_ASYNC_MODULE.
 */
const KEEP = 14;
const DIRECTORY = "backups";

function stamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

async function main(): Promise<void> {
  const { url, authToken } = databaseCredentials();

  // VACUUM INTO writes a file next to whatever the connection is attached to.
  // Against a local file that is this machine's disk; against libsql:// it
  // would be sqld's disk on Turso's side, unreachable from here and not what
  // "back this up" means. Turso already replicates and offers its own
  // export/dump; this script is for the file: URL case only.
  if (authToken) {
    console.error(
      `${url} is a remote database — pnpm db:backup only knows how to VACUUM INTO a local file. Use Turso's own backup/export for a remote database.`,
    );
    process.exit(1);
  }

  await mkdir(DIRECTORY, { recursive: true });

  // Built with forward slashes rather than path.join: this string goes into
  // SQL, where a Windows separator would read as an escape.
  const target = `${DIRECTORY}/grape-${stamp(new Date())}.db`;
  const client = createClient({ url });
  try {
    // Single-quoted SQL string literal; the path is ours, not user input.
    await client.execute(`VACUUM INTO '${target}'`);
  } finally {
    client.close();
  }

  const existing = (await readdir(DIRECTORY))
    .filter((name) => name.startsWith("grape-") && name.endsWith(".db"))
    .sort();
  for (const stale of existing.slice(0, Math.max(0, existing.length - KEEP))) {
    await unlink(path.join(DIRECTORY, stale));
  }

  console.log(`Backed up to ${path.resolve(target)}`);
  console.log(`Keeping the newest ${KEEP}; ${existing.length} present before this run.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
