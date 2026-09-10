import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

import { env } from "@/env";
import { applyPragmas } from "./pragmas";
import * as schema from "./schema";

export type Database = LibSQLDatabase<typeof schema>;

/**
 * This module is server-only. Importing it from a `"use client"` file drags
 * @libsql/client into the browser bundle, where the web build rejects the
 * file: URL of a local database and the failure surfaces as a chunk that will
 * not evaluate — every page it is bundled with goes blank. Fail here instead,
 * naming the actual mistake.
 */
if (typeof window !== "undefined") {
  throw new Error(
    "@/db/client was imported into the browser bundle. Move the value a client component needs into a module that does not reach the database.",
  );
}

/**
 * Next's dev server re-evaluates modules on every hot reload. Without a cache
 * on globalThis that leaks a new libsql connection per edit until the process
 * runs out of file handles.
 */
const globalForDb = globalThis as typeof globalThis & {
  __grapeSqlClient?: Client;
  __grapeDb?: Database;
  __grapeDbReady?: Promise<void>;
};

function create(): { client: Client; db: Database } {
  const client = createClient({ url: env.DATABASE_URL });
  return { client, db: drizzle(client, { schema }) };
}

const existing = globalForDb.__grapeDb && globalForDb.__grapeSqlClient;
const created = existing
  ? { client: globalForDb.__grapeSqlClient!, db: globalForDb.__grapeDb! }
  : create();

/**
 * Awaited once by the route wrapper before any handler runs, so no query can
 * reach the database before the pragmas above are in effect.
 */
export const dbReady: Promise<void> =
  globalForDb.__grapeDbReady ?? applyPragmas(created.client);

if (process.env.NODE_ENV !== "production") {
  globalForDb.__grapeSqlClient = created.client;
  globalForDb.__grapeDb = created.db;
  globalForDb.__grapeDbReady = dbReady;
}

export const sqlClient = created.client;
export const db = created.db;
export { schema };
