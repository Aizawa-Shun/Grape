import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// `generate` only reads the schema and emits SQL — it needs no database driver,
// which is what lets us stay off better-sqlite3. Migrations are applied by
// src/db/migrate.ts through @libsql/client.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  // `dbCredentials` is unused in practice — see the note above, `generate`
  // never opens this URL — and its sqlite type has no `authToken` field to
  // give it even if it did. src/db/migrate.ts is the one that actually
  // connects, through databaseCredentials(), which does carry the token.
  dbCredentials: { url: process.env.DATABASE_URL ?? "file:./grape.db" },
});
