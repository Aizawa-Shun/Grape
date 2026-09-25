import "dotenv/config";

import { createDecipheriv, scryptSync } from "node:crypto";
import { parseArgs } from "node:util";

import { createClient, type Row } from "@libsql/client";

import { db } from "@/db/client";
import { firebaseAuth } from "@/db/firebase";
import type { CollectionName } from "@/db/schema";
import { encryptSecret } from "@/server/secret-box";

/**
 * `pnpm db:import-sqlite <grape.db> --owner-email <you@example.com>`
 *
 * Copies a Grape database from before the move to Firestore into the
 * Firestore this environment points at (production with credentials, or the
 * emulator when FIRESTORE_EMULATOR_HOST is set). Document ids are the old row
 * ids, so running it twice overwrites rather than duplicates.
 *
 * Accounts are matched to Firebase Authentication by e-mail address: sign in
 * to the new Grape once first, so the account exists there. Anything owned by
 * an account that has no Firebase match — including the old loopback
 * development account, `dev@localhost` — goes to --owner-email instead,
 * which is almost always what a single-person instance wants.
 *
 * Passwords are not carried over; Firebase holds those now. Invites are not
 * either: an old code was issued for a registration flow that no longer
 * exists. Stored AI API keys are carried over only with
 * --old-session-secret, the GRAPE_SESSION_SECRET they were encrypted under;
 * without it, each account adds its key again from /account.
 *
 * Wrapped in a function rather than using top-level await — tsx loads this as
 * CommonJS and a top-level await fails with ERR_REQUIRE_ASYNC_MODULE.
 */

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "owner-email": { type: "string" },
    "old-session-secret": { type: "string" },
  },
});

const ms = (value: unknown): Date | null =>
  value === null || value === undefined ? null : new Date(Number(value));
const json = <T>(value: unknown, fallback: T): T =>
  value === null || value === undefined ? fallback : (JSON.parse(String(value)) as T);
const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

/** The old secret-box scheme (AES-256-GCM, key from scrypt of GRAPE_SESSION_SECRET). */
function decryptOld(payload: string, secret: string): string {
  const raw = Buffer.from(payload, "base64");
  const decipher = createDecipheriv("aes-256-gcm", scryptSync(secret, "grape.secret-box.v1", 32), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

async function main(): Promise<void> {
  const [path] = positionals;
  const ownerEmail = values["owner-email"];
  if (!path || !ownerEmail) {
    console.error("usage: pnpm db:import-sqlite <grape.db> --owner-email <you@example.com> [--old-session-secret <secret>]");
    process.exit(2);
  }

  const sqlite = createClient({ url: path.startsWith("file:") ? path : `file:${path}` });
  const all = async (table: string): Promise<Row[]> => {
    try {
      return (await sqlite.execute(`select * from ${table}`)).rows;
    } catch {
      return []; // An older database may predate a table; nothing to copy then.
    }
  };

  const auth = firebaseAuth();
  const owner = await auth.getUserByEmail(ownerEmail).catch(() => null);
  if (!owner) {
    console.error(`No Firebase account for ${ownerEmail}. Sign in to the new Grape once with it, then run this again.`);
    process.exit(1);
  }

  // --- accounts --------------------------------------------------------------
  const uidFor = new Map<string, string>();
  const oldSecret = values["old-session-secret"];
  let keysCarried = 0;

  for (const row of await all("users")) {
    const email = String(row.email).toLowerCase();
    const match = await auth.getUserByEmail(email).catch(() => null);
    const uid = match?.uid ?? owner.uid;
    uidFor.set(String(row.id), uid);
    if (!match && uid === owner.uid) console.log(`  ${email}: no Firebase account — its data goes to ${ownerEmail}`);

    const reKey = (value: unknown): string | null => {
      if (!value || !oldSecret) return null;
      try {
        const carried = encryptSecret(decryptOld(String(value), oldSecret));
        keysCarried += 1;
        return carried;
      } catch {
        console.warn(`  ${email}: an API key could not be decrypted with --old-session-secret; skipped`);
        return null;
      }
    };

    // The owner's own document is written last, below, so an unmatched
    // account's role cannot overwrite theirs.
    if (uid === owner.uid) continue;
    await db.users.set(uid, {
      email,
      displayName: String(row.display_name),
      role: row.role === "owner" ? "owner" : "member",
      anthropicApiKey: reKey(row.anthropic_api_key),
      openaiApiKey: reKey(row.openai_api_key),
      createdAt: ms(row.created_at) ?? new Date(),
      lastLoginAt: ms(row.last_login_at),
    });
  }

  const existingOwner = await db.users.get(owner.uid);
  await db.users.set(owner.uid, {
    email: ownerEmail.toLowerCase(),
    displayName: existingOwner?.displayName ?? owner.displayName ?? ownerEmail.split("@")[0],
    role: "owner",
    anthropicApiKey: existingOwner?.anthropicApiKey ?? null,
    openaiApiKey: existingOwner?.openaiApiKey ?? null,
    createdAt: existingOwner?.createdAt ?? new Date(),
    lastLoginAt: existingOwner?.lastLoginAt ?? null,
  });

  const ownerOf = (userId: unknown) => uidFor.get(String(userId)) ?? owner.uid;

  // --- everything else, table by table --------------------------------------
  const counts: Partial<Record<CollectionName, number>> = {};
  const copy = async <K extends CollectionName>(
    name: K,
    table: string,
    map: (row: Row) => Record<string, unknown>,
  ) => {
    const rows = await all(table);
    for (const row of rows) {
      const doc = map(row);
      await (db[name] as unknown as { set(id: string, doc: unknown): Promise<unknown> }).set(String(row.id ?? row.key), doc);
    }
    counts[name] = rows.length;
  };

  await copy("products", "products", (r) => ({
    userId: ownerOf(r.user_id),
    url: String(r.url),
    name: String(r.name),
    keyEventName: str(r.key_event_name),
    setupStatus: r.setup_status === "pending" ? "failed" : (str(r.setup_status) ?? "ready"),
    setupError: r.setup_status === "pending" ? "移行時に読み込み中だったため、読み直してください。" : str(r.setup_error),
    setupClaimedAt: null,
    createdAt: ms(r.created_at),
  }));
  await copy("productContexts", "product_contexts", (r) => ({
    productId: String(r.product_id),
    version: Number(r.version),
    what: String(r.what),
    who: String(r.who),
    why: String(r.why),
    how: String(r.how),
    sourcePages: json<string[]>(r.source_pages, []),
    confidence: num(r.confidence),
    gaps: json<string[]>(r.gaps, []),
    analysis: json(r.analysis, null),
    primaryLanguage: str(r.primary_language),
    editedByHuman: Boolean(Number(r.edited_by_human)),
    createdAt: ms(r.created_at),
  }));
  await copy("crawlPages", "crawl_pages", (r) => ({
    productId: String(r.product_id),
    url: String(r.url),
    status: Number(r.status),
    title: str(r.title),
    text: str(r.text),
    meta: json(r.meta, null),
    renderedWith: str(r.rendered_with) ?? "static",
    fetchedAt: ms(r.fetched_at),
  }));
  await copy("events", "events", (r) => ({
    productId: String(r.product_id),
    anonId: String(r.anon_id),
    sessionId: String(r.session_id),
    name: String(r.name),
    path: str(r.path),
    referrer: str(r.referrer),
    utm: json(r.utm, null),
    ts: ms(r.ts),
  }));
  await copy("diagnoses", "diagnoses", (r) => ({
    productId: String(r.product_id),
    contextVersion: Number(r.context_version),
    windowStart: ms(r.window_start),
    windowEnd: ms(r.window_end),
    mode: String(r.mode),
    bottleneckStage: String(r.bottleneck_stage),
    summary: String(r.summary),
    evidence: json(r.evidence, null),
    confidence: num(r.confidence),
    model: str(r.model),
    createdAt: ms(r.created_at),
  }));
  await copy("tasks", "tasks", (r) => ({
    productId: String(r.product_id),
    diagnosisId: str(r.diagnosis_id),
    title: String(r.title),
    rationale: String(r.rationale),
    stage: String(r.stage),
    channel: String(r.channel),
    expectedMetric: String(r.expected_metric),
    expectedDirection: String(r.expected_direction),
    impact: Number(r.impact),
    effort: Number(r.effort),
    status: String(r.status),
    dueWeek: String(r.due_week),
    createdAt: ms(r.created_at),
    completedAt: ms(r.completed_at),
  }));
  await copy("artifacts", "artifacts", (r) => ({
    taskId: String(r.task_id),
    kind: String(r.kind),
    content: String(r.content),
    createdAt: ms(r.created_at),
  }));
  await copy("actionRuns", "action_runs", (r) => ({
    taskId: String(r.task_id),
    artifactId: str(r.artifact_id),
    channel: String(r.channel),
    payload: json(r.payload, null),
    status: String(r.status),
    externalUrl: str(r.external_url),
    costEstimateUsd: num(r.cost_estimate_usd),
    response: json(r.response, null),
    approvedAt: ms(r.approved_at),
    executedAt: ms(r.executed_at),
    createdAt: ms(r.created_at),
  }));
  await copy("outcomes", "outcomes", (r) => ({
    taskId: String(r.task_id),
    metric: String(r.metric),
    before: Number(r.before),
    after: Number(r.after),
    windowDays: Number(r.window_days),
    delta: Number(r.delta),
    evaluatedAt: ms(r.evaluated_at),
  }));
  await copy("llmCalls", "llm_calls", (r) => ({
    productId: str(r.product_id),
    userId: r.user_id === null ? owner.uid : ownerOf(r.user_id),
    taskKind: String(r.task_kind),
    provider: String(r.provider),
    model: String(r.model),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    cacheReadInputTokens: Number(r.cache_read_input_tokens ?? 0),
    cacheCreationInputTokens: Number(r.cache_creation_input_tokens ?? 0),
    costUsd: Number(r.cost_usd),
    createdAt: ms(r.created_at),
  }));
  await copy("settings", "settings", (r) => ({ value: String(r.value), updatedAt: ms(r.updated_at) }));

  console.log("Imported:", { users: uidFor.size, ...counts, apiKeys: keysCarried });
  sqlite.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
