import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

import { env } from "@/env";
import * as schema from "./schema";

export type Database = LibSQLDatabase<typeof schema>;

/**
 * Next's dev server re-evaluates modules on every hot reload. Without a cache
 * on globalThis that leaks a new libsql connection per edit until the process
 * runs out of file handles.
 */
const globalForDb = globalThis as typeof globalThis & {
  __grapeSqlClient?: Client;
  __grapeDb?: Database;
};

function create(): { client: Client; db: Database } {
  const client = createClient({ url: env.DATABASE_URL });
  return { client, db: drizzle(client, { schema }) };
}

const existing = globalForDb.__grapeDb && globalForDb.__grapeSqlClient;
const created = existing
  ? { client: globalForDb.__grapeSqlClient!, db: globalForDb.__grapeDb! }
  : create();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__grapeSqlClient = created.client;
  globalForDb.__grapeDb = created.db;
}

export const sqlClient = created.client;
export const db = created.db;
export { schema };
