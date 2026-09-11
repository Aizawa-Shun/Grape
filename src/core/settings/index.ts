import { eq } from "drizzle-orm";

import { AppError } from "@/core/errors";
import { db, schema, type Database } from "@/db/client";
import { env, parseEnv, type Env } from "@/env";

/**
 * Settings that can be changed from the web, layered over .env.
 *
 * The whole layer exists because `.env` cannot be edited usefully at runtime:
 * `parseEnv(process.env)` runs once at import, so writing that file would show
 * a save that changed nothing until the next restart. Storing the override in
 * SQLite and merging it means a change takes effect on the next request.
 *
 * Validation is not reimplemented here. The effective configuration is
 * `parseEnv({ ...process.env, ...overrides })`, so every rule the env schema
 * already enforces — the http(s) URL check, the integer coercion, the provider
 * enum, the cross-field requirement that a remote openai-compat endpoint has a
 * key — applies to a value typed into the browser exactly as it does to one
 * typed into a file. One schema, one set of rules.
 */

/**
 * What is *not* here matters as much as what is.
 *
 * - Secrets (API keys, the admin password, the X credentials) stay in .env so
 *   that an auth bypass on a tunnel-exposed instance cannot read or rewrite
 *   them, and so they never sit in a database file that gets backed up.
 * - DATABASE_URL cannot be here: it is what this table is read from.
 * - GRAPE_ACTION_DRY_RUN is excluded on purpose. Posting to X is irreversible
 *   and metered, and "edit a file, then restart" is a deliberate brake — see
 *   the comment in api/tasks/[id]/approve/route.ts. Turning it into a toggle
 *   would put one click between a draft and a real, billed post.
 */
export const OVERRIDABLE_KEYS = [
  "LLM_PROVIDER",
  "ANTHROPIC_MODEL",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "INGEST_BASE_URL",
  "COLD_START_MIN_SESSIONS",
  "LLM_TIMEOUT_MS",
  "LLM_HEALTH_TIMEOUT_MS",
  "LLM_MAX_REPAIRS",
  "LLM_MONTHLY_BUDGET_USD",
  "GRAPE_EVENT_RETENTION_DAYS",
  "GRAPE_LOG_LEVEL",
] as const;

export type OverridableKey = (typeof OVERRIDABLE_KEYS)[number];

const OVERRIDABLE = new Set<string>(OVERRIDABLE_KEYS);

export function isOverridable(key: string): key is OverridableKey {
  return OVERRIDABLE.has(key);
}

/**
 * Merges overrides over the process environment and validates the result.
 *
 * Pure, so the rules can be tested without a database — the same shape as
 * parseEnv itself.
 */
export function resolveSettings(
  source: Record<string, string | undefined>,
  overrides: Partial<Record<OverridableKey, string>>,
): Env {
  const merged = { ...source };
  for (const [key, value] of Object.entries(overrides)) {
    if (isOverridable(key) && value !== undefined) merged[key] = value;
  }
  return parseEnv(merged);
}

let cache: Env | null = null;
let overrideCache: Partial<Record<OverridableKey, string>> = {};

/**
 * Synchronous, for the callers that cannot await — `log.ts` emits from
 * anywhere, including hot paths. Before the first load it returns the env
 * values, which is the correct answer rather than a placeholder: with no
 * override loaded yet, env *is* the configuration.
 */
export function currentSettings(): Env {
  return cache ?? env;
}

/** What is currently coming from the database rather than from .env. */
export function currentOverrides(): Partial<Record<OverridableKey, string>> {
  return { ...overrideCache };
}

export async function loadSettings(database?: Database): Promise<Env> {
  if (cache) return cache;
  return reloadSettings(database);
}

export async function reloadSettings(database?: Database): Promise<Env> {
  const conn = database ?? db;
  const rows = await conn.select().from(schema.settings);

  const overrides: Partial<Record<OverridableKey, string>> = {};
  for (const row of rows) {
    if (isOverridable(row.key)) overrides[row.key] = row.value;
  }

  try {
    cache = resolveSettings(process.env, overrides);
    overrideCache = overrides;
  } catch (error) {
    // A stored override can only become invalid if .env changed underneath it
    // — a key removed, say. Falling back to env keeps the app bootable and
    // keeps the settings screen reachable, which is the only way back that
    // does not involve opening SQLite by hand.
    cache = env;
    overrideCache = {};
    throw new AppError("INTERNAL", "Stored settings are no longer valid; falling back to .env", {
      cause: error,
    });
  }

  return cache;
}

/**
 * The overridable values only, as strings.
 *
 * Exists so that nothing can hand the whole `Env` object to a client: it also
 * carries the API keys, the admin password and the X credentials, and the
 * entire reason those are excluded from this layer is that they should never
 * leave the file they are configured in.
 */
export function publicSettings(settings: Env): Record<OverridableKey, string> {
  return Object.fromEntries(
    OVERRIDABLE_KEYS.map((key) => [key, String(settings[key] ?? "")]),
  ) as Record<OverridableKey, string>;
}

export interface SaveResult {
  settings: Env;
  overrides: Partial<Record<OverridableKey, string>>;
}

/**
 * Writes a patch and returns the new effective configuration.
 *
 * An empty string means "go back to whatever .env says", which deletes the row
 * rather than storing a blank — otherwise the database would slowly accumulate
 * values that only shadow the defaults they duplicate.
 */
export async function saveSettings(
  patch: Partial<Record<OverridableKey, string>>,
  database?: Database,
): Promise<SaveResult> {
  const conn = database ?? db;

  const next: Partial<Record<OverridableKey, string>> = { ...currentOverrides() };
  for (const [key, value] of Object.entries(patch)) {
    if (!isOverridable(key)) continue;
    const trimmed = value?.trim() ?? "";
    if (trimmed === "") delete next[key];
    else next[key] = trimmed;
  }

  // Validated before anything is written, so a rejected value never becomes
  // the configuration the next request runs on.
  let resolved: Env;
  try {
    resolved = resolveSettings(process.env, next);
  } catch (error) {
    throw new AppError("INVALID_INPUT", error instanceof Error ? error.message : String(error), {
      cause: error,
    });
  }

  const now = new Date();
  for (const key of OVERRIDABLE_KEYS) {
    const value = next[key];
    if (value === undefined) {
      await conn.delete(schema.settings).where(eq(schema.settings.key, key));
      continue;
    }
    await conn
      .insert(schema.settings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: now } });
  }

  cache = resolved;
  overrideCache = next;
  return { settings: resolved, overrides: next };
}

/** Tests only — the cache is process-wide by design. */
export function resetSettingsCache(): void {
  cache = null;
  overrideCache = {};
}
