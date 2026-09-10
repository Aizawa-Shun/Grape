import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { TASK_KINDS } from "@/core/llm/types";

/**
 * Grape's data model.
 *
 * The shape follows the loop from the spec:
 *
 *   products / product_contexts / crawl_pages   -> Product Context
 *   events                                      -> Product Data
 *   diagnoses -> tasks -> artifacts -> action_runs -> outcomes -> (re-diagnose)
 *
 * `outcomes` is what closes the loop. Without it Grape only ever recommends;
 * it never learns whether a recommendation worked.
 *
 * Tenancy hangs off `products.user_id`. Every other table reaches its owner
 * through `product_id` or `task_id`, so it is the one column that has to be
 * right. `llm_calls` is the exception that also carries `user_id` directly:
 * it has no product for some calls, and unlike a default, who made a past
 * call cannot be worked out after the fact.
 */

/**
 * The owner every product had before there were accounts. Rows still carrying
 * it are adopted by the first person to register (core/auth/users.ts); nothing
 * writes it any more, which is why `products.user_id` no longer defaults to it.
 */
export const LOCAL_USER = "local";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

// --- Enumerations shared with the rest of the app ---------------------------

export const FUNNEL_STAGES = ["reach", "visit", "engage", "activate", "retain"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const DIAGNOSIS_MODES = ["funnel", "audit"] as const;
export type DiagnosisMode = (typeof DIAGNOSIS_MODES)[number];

export const TASK_STATUSES = ["proposed", "approved", "executing", "done", "skipped"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const CHANNELS = ["manual", "x"] as const;
export type Channel = (typeof CHANNELS)[number];

export const ARTIFACT_KINDS = ["x_post", "lp_copy", "meta", "email"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const ACTION_RUN_STATUSES = ["pending", "dry_run", "sent", "failed"] as const;
export type ActionRunStatus = (typeof ACTION_RUN_STATUSES)[number];

export const USER_ROLES = ["owner", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

// --- Accounts ---------------------------------------------------------------

/**
 * `passwordHash` is scrypt with its parameters embedded — see
 * server/auth/password.ts. There is no e-mail sender anywhere in Grape, so
 * there is deliberately no reset token here: recovery is the owner re-issuing
 * an invite, or `pnpm db:reset-password` on the server.
 *
 * "owner" is the first account to register and the only one that can invite.
 *
 * `passwordHash` stays NOT NULL even for a Google-only account: one that has
 * never set a password gets a hash no scrypt output can ever equal (see
 * core/auth/google.ts), rather than a nullable column that every password
 * check would need to remember to guard. `googleId` is nullable and unique —
 * unique so the same Google account cannot attach to two rows, nullable
 * because most rows here predate Google sign-in and plenty will never use it.
 */
export const users = sqliteTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    googleId: text("google_id"),
    role: text("role", { enum: USER_ROLES }).notNull().default("member"),
    createdAt: createdAt(),
    lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email), uniqueIndex("users_google_id_idx").on(t.googleId)],
);

/**
 * Registration is closed once one account exists, so a second person needs a
 * code from the first.
 *
 * Only the hash is stored, for the same reason passwords are not kept in
 * plaintext: a stolen database should not hand over working credentials. The
 * code itself exists once, in the response that created it.
 */
export const invites = sqliteTable(
  "invites",
  {
    id: id(),
    codeHash: text("code_hash").notNull(),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
    usedBy: text("used_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invites_code_idx").on(t.codeHash)],
);

// --- ① PRODUCT --------------------------------------------------------------

export const products = sqliteTable(
  "products",
  {
    id: id(),
    userId: text("user_id").notNull(),
    url: text("url").notNull(),
    name: text("name").notNull(),
    /**
     * The event name that counts as activation for *this* product, e.g.
     * "signup" or "project_created". Null until the owner picks one, which is
     * why the funnel can compute reach/visit/engage/retain before it can
     * compute activate.
     */
    keyEventName: text("key_event_name"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("products_user_url_idx").on(t.userId, t.url)],
);

/**
 * Versioned, never overwritten. A diagnosis records which context version it
 * reasoned over, so a later context correction does not silently rewrite the
 * history of why a decision was made.
 */
export const productContexts = sqliteTable(
  "product_contexts",
  {
    id: id(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    what: text("what").notNull(),
    who: text("who").notNull(),
    why: text("why").notNull(),
    how: text("how").notNull(),
    sourcePages: text("source_pages", { mode: "json" }).$type<string[]>().notNull(),
    confidence: real("confidence"),
    /**
     * What the source pages never stated, so extraction refused to guess it
     * (see extract.ts). A site not saying who it's for is itself a finding —
     * worth surfacing in the UI, not worth discarding after a paid LLM call.
     */
    gaps: text("gaps", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** BCP-47 code of the site's primary language. Null on a human edit. */
    primaryLanguage: text("primary_language"),
    /** Set when a human corrected the extraction. Downstream prompts say so. */
    editedByHuman: integer("edited_by_human", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("product_contexts_version_idx").on(t.productId, t.version)],
);

export const crawlPages = sqliteTable(
  "crawl_pages",
  {
    id: id(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    status: integer("status").notNull(),
    title: text("title"),
    /** Visible text, tags stripped. The raw HTML is not worth the disk. */
    text: text("text"),
    meta: text("meta", { mode: "json" }).$type<Record<string, string>>(),
    /**
     * "browser" means the served HTML carried no text and the page only became
     * readable after client-side rendering. That is a Reach-stage finding, not
     * just a crawl detail: anything reading the page without running scripts —
     * search engines, link previews, this crawler's own fast path — sees the
     * empty shell too. Only observable at crawl time, so it is recorded here.
     */
    renderedWith: text("rendered_with", { enum: ["static", "browser"] })
      .notNull()
      .default("static"),
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("crawl_pages_product_idx").on(t.productId, t.fetchedAt)],
);

// --- Product Data -----------------------------------------------------------

/**
 * Raw event stream from public/g.js. Deliberately append-only and unaggregated:
 * the funnel definition will change as we learn, and re-deriving it from raw
 * events is only possible if we never threw the raw events away.
 */
export const events = sqliteTable(
  "events",
  {
    id: id(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Stable per-browser id. Retention is measured against this. */
    anonId: text("anon_id").notNull(),
    sessionId: text("session_id").notNull(),
    name: text("name").notNull(),
    path: text("path"),
    referrer: text("referrer"),
    utm: text("utm", { mode: "json" }).$type<Record<string, string>>(),
    ts: integer("ts", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("events_product_ts_idx").on(t.productId, t.ts),
    index("events_session_idx").on(t.productId, t.sessionId),
    index("events_anon_idx").on(t.productId, t.anonId, t.ts),
  ],
);

// --- ⑤ LEARN: Intelligence output -------------------------------------------

export const diagnoses = sqliteTable(
  "diagnoses",
  {
    id: id(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    contextVersion: integer("context_version").notNull(),
    windowStart: integer("window_start", { mode: "timestamp_ms" }).notNull(),
    windowEnd: integer("window_end", { mode: "timestamp_ms" }).notNull(),
    /** "funnel" when there was enough traffic to measure, "audit" otherwise. */
    mode: text("mode", { enum: DIAGNOSIS_MODES }).notNull(),
    bottleneckStage: text("bottleneck_stage", { enum: FUNNEL_STAGES }).notNull(),
    summary: text("summary").notNull(),
    /** The numbers the conclusion rests on, so it can be audited later. */
    evidence: text("evidence", { mode: "json" }).$type<unknown>(),
    confidence: real("confidence"),
    model: text("model"),
    createdAt: createdAt(),
  },
  (t) => [index("diagnoses_product_idx").on(t.productId, t.createdAt)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: id(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    diagnosisId: text("diagnosis_id").references(() => diagnoses.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    rationale: text("rationale").notNull(),
    stage: text("stage", { enum: FUNNEL_STAGES }).notNull(),
    channel: text("channel", { enum: CHANNELS }).notNull().default("manual"),
    /** Which metric this task claims it will move, and which way. */
    expectedMetric: text("expected_metric").notNull(),
    expectedDirection: text("expected_direction", { enum: ["up", "down"] }).notNull().default("up"),
    impact: integer("impact").notNull(),
    effort: integer("effort").notNull(),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("proposed"),
    /** ISO week the task belongs to, e.g. "2026-W37". */
    dueWeek: text("due_week").notNull(),
    createdAt: createdAt(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("tasks_product_week_idx").on(t.productId, t.dueWeek)],
);

// --- ④ Action ---------------------------------------------------------------

/** The generated deliverable for a task — the post text, the headline, etc. */
export const artifacts = sqliteTable(
  "artifacts",
  {
    id: id(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ARTIFACT_KINDS }).notNull(),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("artifacts_task_idx").on(t.taskId)],
);

/**
 * One attempted execution. Rows start as "pending" and only leave that state
 * through an explicit human approval, so there is always a record of what was
 * about to be published before it was published.
 */
export const actionRuns = sqliteTable(
  "action_runs",
  {
    id: id(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    artifactId: text("artifact_id").references(() => artifacts.id, { onDelete: "set null" }),
    channel: text("channel", { enum: CHANNELS }).notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
    status: text("status", { enum: ACTION_RUN_STATUSES }).notNull().default("pending"),
    externalUrl: text("external_url"),
    costEstimateUsd: real("cost_estimate_usd"),
    response: text("response", { mode: "json" }).$type<unknown>(),
    approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
    executedAt: integer("executed_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("action_runs_task_idx").on(t.taskId, t.createdAt)],
);

/** Did the task actually move the metric it claimed it would? */
export const outcomes = sqliteTable(
  "outcomes",
  {
    id: id(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    before: real("before").notNull(),
    after: real("after").notNull(),
    windowDays: integer("window_days").notNull(),
    delta: real("delta").notNull(),
    evaluatedAt: integer("evaluated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("outcomes_task_idx").on(t.taskId)],
);

/**
 * One row per model call, so `core/llm/budget.ts` can sum this month's
 * estimated spend before the next call goes out.
 *
 * `productId` is nullable and `set null` rather than `cascade`: extraction
 * runs during registration, before the product row that will reference it is
 * committed, and a call already billed should not vanish because the product
 * was later deleted — the point of this table is an accurate spend history,
 * not a per-product one.
 *
 * `userId` is nullable on the same grounds plus one more: scripts and tests
 * spend nothing on anyone's behalf, and a call made before accounts existed
 * has no owner to name. It is recorded from the moment there is a session to
 * read it from, because who made a call is not something that can be worked
 * out later.
 */
export const llmCalls = sqliteTable(
  "llm_calls",
  {
    id: id(),
    productId: text("product_id").references(() => products.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    taskKind: text("task_kind", { enum: TASK_KINDS }).notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadInputTokens: integer("cache_read_input_tokens").notNull().default(0),
    cacheCreationInputTokens: integer("cache_creation_input_tokens").notNull().default(0),
    /** Estimated, not billed — see core/llm/pricing.ts for the rate table and its caveats. */
    costUsd: real("cost_usd").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("llm_calls_created_idx").on(t.createdAt),
    index("llm_calls_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/**
 * Settings a person can change from the web, layered over the values in .env.
 *
 * Only exists because editing `.env` cannot take effect without a restart —
 * `parseEnv(process.env)` runs once at import — so a settings screen that
 * wrote to that file would appear to save while changing nothing.
 *
 * Deliberately not a home for secrets or for GRAPE_ACTION_DRY_RUN: see
 * core/settings for which keys are allowed and why.
 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  /** Stored as text and re-validated through the env schema on the way out. */
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
