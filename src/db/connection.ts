/**
 * The two environment variables every script and the app itself need to open
 * the same database: a local file needs only a path, but a remote libsql
 * server (Turso) needs a bearer token alongside its URL.
 *
 * Reads `process.env` directly rather than the validated `env` object,
 * because the one-off scripts under `src/db/` (migrate, backup, prune,
 * reset-password) run standalone under `tsx` and have never gone through
 * `@/env` — duplicating that dependency for five scripts to save one optional
 * field is not worth it. `db/client.ts`, which does use `@/env`, still ends
 * up with the same two values.
 */
export function databaseCredentials(): { url: string; authToken?: string } {
  const url = process.env.DATABASE_URL ?? "file:./grape.db";
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  return authToken ? { url, authToken } : { url };
}
