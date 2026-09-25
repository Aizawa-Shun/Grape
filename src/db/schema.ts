import type { SaasAnalysis } from "@/core/context/analysis";
import type { TaskKind } from "@/core/llm/types";

/**
 * Grape's data model, as Firestore documents.
 *
 * The shape follows the loop from the spec:
 *
 *   products / productContexts / crawlPages     -> Product Context
 *   events                                      -> Product Data
 *   diagnoses -> tasks -> artifacts -> actionRuns -> outcomes -> (re-diagnose)
 *
 * `outcomes` is what closes the loop. Without it Grape only ever recommends;
 * it never learns whether a recommendation worked.
 *
 * Every collection is top-level with a foreign-key field (`productId`,
 * `taskId`) rather than nested as a subcollection. That keeps each query a
 * plain equality filter on one collection, and the cascades a relational
 * database used to do for free are done by hand in core/product/delete.ts.
 *
 * Tenancy hangs off `products.userId`. Everything else reaches its owner
 * through `productId` or `taskId`, so that is the one field that has to be
 * right. `llmCalls` also carries `userId` directly: some calls have no
 * product, and who made a past call cannot be worked out after the fact.
 *
 * Nullable fields are always written — as `null`, never left out — so that a
 * `== null` filter matches them. Firestore does not match missing fields.
 */

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

export const PRODUCT_SETUP_STATUSES = ["pending", "ready", "failed"] as const;
export type ProductSetupStatus = (typeof PRODUCT_SETUP_STATUSES)[number];

// --- Accounts ---------------------------------------------------------------

/**
 * One per Firebase Authentication account, keyed by its uid. Firebase owns the
 * credential — password, Google link, reset e-mails — and this document owns
 * what Grape needs on top of it: whether the account is the owner, and its
 * own LLM API keys.
 *
 * "owner" is the first account to sign in and the only one that can invite.
 *
 * `anthropicApiKey` / `openaiApiKey` are that account's own credential for
 * calling a model (core/auth/users.ts). They have to come back out whole, so
 * they are encrypted (server/secret-box.ts) rather than hashed.
 */
export interface User {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

/**
 * Registration is closed once one account exists, so a second person needs a
 * code from the first. Only the hash is stored: a leaked database should not
 * hand over working codes.
 */
export interface Invite {
  id: string;
  codeHash: string;
  invitedBy: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  usedBy: string | null;
  createdAt: Date;
}

// --- ① PRODUCT --------------------------------------------------------------

/**
 * `(userId, url)` is unique: one account cannot register a site twice.
 * Firestore has no unique index, so core/product/register.ts enforces it with
 * a transaction over a query on both fields.
 */
export interface Product {
  id: string;
  userId: string;
  url: string;
  name: string;
  /** The event name that means "activated" — see core/data/funnel.ts. */
  keyEventName: string | null;
  /** How far the crawl-and-read pass has got; see core/product/register.ts. */
  setupStatus: ProductSetupStatus;
  setupError: string | null;
  createdAt: Date;
}

/**
 * Versioned: a human correction is a new version, never an overwrite, because
 * a diagnosis references the version it reasoned over (core/context/edit.ts).
 *
 * `analysis` is the full structured reading when a model produced one; the
 * four text fields stay authoritative for everything downstream.
 */
export interface ProductContext {
  id: string;
  productId: string;
  version: number;
  what: string;
  who: string;
  why: string;
  how: string;
  sourcePages: string[];
  confidence: number | null;
  /** What the site never stated — read by the cold-start audit. */
  gaps: string[];
  analysis: SaasAnalysis | null;
  primaryLanguage: string | null;
  editedByHuman: boolean;
  createdAt: Date;
}

/** The current snapshot of the site, replaced on every read (not a history). */
export interface CrawlPage {
  id: string;
  productId: string;
  url: string;
  status: number;
  title: string | null;
  text: string | null;
  meta: Record<string, string> | null;
  renderedWith: "static" | "browser";
  fetchedAt: Date;
}

// --- ② DATA -----------------------------------------------------------------

/** One tracked event from the snippet. Server time, never the client's. */
export interface Event {
  id: string;
  productId: string;
  anonId: string;
  sessionId: string;
  name: string;
  path: string | null;
  referrer: string | null;
  utm: Record<string, string> | null;
  ts: Date;
}

// --- ③ DIAGNOSE / ④ ACT / ⑤ LEARN ------------------------------------------

export interface Diagnosis {
  id: string;
  productId: string;
  contextVersion: number;
  windowStart: Date;
  windowEnd: Date;
  mode: DiagnosisMode;
  bottleneckStage: FunnelStage;
  summary: string;
  evidence: unknown;
  confidence: number | null;
  model: string | null;
  createdAt: Date;
}

export interface Task {
  id: string;
  productId: string;
  /** Null once the diagnosis it came from is deleted. */
  diagnosisId: string | null;
  title: string;
  rationale: string;
  stage: FunnelStage;
  channel: Channel;
  expectedMetric: string;
  expectedDirection: "up" | "down";
  impact: number;
  effort: number;
  status: TaskStatus;
  dueWeek: string;
  createdAt: Date;
  completedAt: Date | null;
}

export interface Artifact {
  id: string;
  taskId: string;
  kind: ArtifactKind;
  content: string;
  createdAt: Date;
}

export interface ActionRun {
  id: string;
  taskId: string;
  artifactId: string | null;
  channel: Channel;
  payload: unknown;
  status: ActionRunStatus;
  externalUrl: string | null;
  costEstimateUsd: number | null;
  response: unknown;
  approvedAt: Date | null;
  executedAt: Date | null;
  createdAt: Date;
}

export interface Outcome {
  id: string;
  taskId: string;
  metric: string;
  before: number;
  after: number;
  windowDays: number;
  delta: number;
  evaluatedAt: Date;
}

/** Estimated, not billed — see core/llm/pricing.ts. */
export interface LlmCall {
  id: string;
  productId: string | null;
  userId: string | null;
  taskKind: TaskKind;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
  createdAt: Date;
}

/**
 * Settings a person can change from the web, layered over the environment.
 * The document id is the setting's key. Deliberately not a home for secrets:
 * see core/settings for which keys are allowed and why.
 */
export interface Setting {
  id: string;
  value: string;
  updatedAt: Date;
}

/** Every collection, by the name its documents live under in Firestore. */
export interface Collections {
  users: User;
  invites: Invite;
  products: Product;
  productContexts: ProductContext;
  crawlPages: CrawlPage;
  events: Event;
  diagnoses: Diagnosis;
  tasks: Task;
  artifacts: Artifact;
  actionRuns: ActionRun;
  outcomes: Outcome;
  llmCalls: LlmCall;
  settings: Setting;
}

export type CollectionName = keyof Collections;

export const COLLECTION_NAMES = [
  "users",
  "invites",
  "products",
  "productContexts",
  "crawlPages",
  "events",
  "diagnoses",
  "tasks",
  "artifacts",
  "actionRuns",
  "outcomes",
  "llmCalls",
  "settings",
] as const satisfies readonly CollectionName[];
