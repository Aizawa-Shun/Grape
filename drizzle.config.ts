import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// `generate` only reads the schema and emits SQL — it needs no database driver,
// which is what lets us stay off better-sqlite3. Migrations are applied by
// src/db/migrate.ts through @libsql/client.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url: process.env.DATABASE_URL ?? "file:./grape.db" },
});
