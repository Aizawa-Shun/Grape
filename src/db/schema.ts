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
  /** The event that means someone signed up. Growth counts signups from it (core/growth/attribution.ts). */
  signupEventName: string | null;
  /** The event that means someone paid. */
  paidEventName: string | null;
  /** How far the crawl-and-read pass has got; see core/product/register.ts. */
  setupStatus: ProductSetupStatus;
  setupError: string | null;
  /**
   * When a request last took on the crawl for this product — a lease, so two
   * browsers watching the same pending product do not both crawl it, and a
   * crawl whose request died is picked up again once the lease runs out.
   */
  setupClaimedAt: Date | null;
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

// --- ⑥ MARKETING BRAIN ------------------------------------------------------
//
// What Grape knows about a product's marketing, and how it comes to know it.
// The brain is a loop, not a feature list:
//
//   Product knowledge ─┐
//                      ├─► Audience & positioning ─► Strategy ─► Hypotheses
//   Market knowledge ──┘                                              │
//        ▲                                                            ▼
//        └──────────── Learnings ◄── Results ◄── Execution (posts on X)
//
// The strategy is a set of claims about what will work, each tested by posts
// written for it; what the results say is kept as a learning, and learnings
// change the next strategy. core/growth/ owns all of it.
//
// Everything a research step writes carries the `runId` that produced it, so a
// later run replaces a finding rather than piling a second copy on top of it:
// readers take the rows of the latest completed run (see core/growth/latest.ts).

export const GROWTH_STEP_KINDS = [
  "product",
  "market",
  "competitors",
  "audience",
  "positioning",
  "strategy",
  "experiments",
  "ideas",
  "content",
  "opportunities",
  "watch",
  "metrics",
  "measure",
  "learn",
  "revise",
  "autopilot",
] as const;
export type GrowthStepKind = (typeof GROWTH_STEP_KINDS)[number];

export const GROWTH_STEP_STATUSES = ["pending", "running", "completed", "failed", "skipped"] as const;
export type GrowthStepStatus = (typeof GROWTH_STEP_STATUSES)[number];

export const GROWTH_RUN_KINDS = ["initial", "daily", "manual"] as const;
export type GrowthRunKind = (typeof GROWTH_RUN_KINDS)[number];

export const GROWTH_RUN_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type GrowthRunStatus = (typeof GROWTH_RUN_STATUSES)[number];

/** One unit of a run, done inside one request (see core/growth/runs.ts). */
export interface GrowthStep {
  kind: GrowthStepKind;
  status: GrowthStepStatus;
  attempts: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  /** A sentence for the reader: what was found, or why it failed. */
  summary: string | null;
  error: string | null;
}

/**
 * A job. Steps run one per request, claimed with a lease like product setup:
 * App Hosting is Cloud Run, which only promises CPU to a request in flight, so
 * nothing here may run after a response has gone out.
 */
export interface GrowthRun {
  id: string;
  productId: string;
  userId: string;
  kind: GrowthRunKind;
  status: GrowthRunStatus;
  steps: GrowthStep[];
  claimedAt: Date | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export const GOAL_METRICS = ["visitors", "signups", "activations", "paid"] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

/** "Get 100 new users in 30 days." Progress is counted from events, never typed in. */
export interface GrowthGoal {
  id: string;
  productId: string;
  metric: GoalMetric;
  target: number;
  startAt: Date;
  deadline: Date;
  status: "active" | "achieved" | "archived";
  createdAt: Date;
}

export type Confidence = "low" | "medium" | "high";

// --- Product knowledge ------------------------------------------------------

/**
 * Known or assumed — never blurred.
 *
 * `known` is a claim with a source: a sentence on the product's own site,
 * checked by code to really be there (core/growth/knowledge.ts), or something
 * its owner told Grape. `assumption` is everything else the model worked out —
 * shown, used, and always labelled as such. What is not known at all is not a
 * fact but a question (`OpenQuestion`), asked of the owner.
 */
export type FactStatus = "known" | "assumption";
export const FACT_BASES = ["site", "owner", "inference"] as const;
export type FactBasis = (typeof FACT_BASES)[number];

export interface Evidence {
  url: string;
  quote: string;
}

export interface Fact {
  text: string;
  status: FactStatus;
  basis: FactBasis;
  evidence: Evidence[];
}

export const KNOWLEDGE_TOPICS = [
  "what",
  "targetUsers",
  "problems",
  "benefits",
  "features",
  "differentiators",
  "useCases",
  "pricing",
  "proof",
] as const;
export type KnowledgeTopic = (typeof KNOWLEDGE_TOPICS)[number];

/** Something marketing needs and the site does not establish — asked of the owner in plain words. */
export interface OpenQuestion {
  id: string;
  topic: KnowledgeTopic;
  question: string;
  whyItMatters: string;
  /** Our best guess, offered to be confirmed or corrected. */
  guess: string | null;
}

/** What someone's own writing sounds like, so drafts can sound like them. */
export interface BrandVoice {
  samples: string[];
  tone: string;
  vocabulary: string;
  sentenceLength: string;
  emoji: string;
  technicalLevel: string;
  formality: string;
  humor: string;
  guidelines: string[];
}

/**
 * One per product, keyed by its id. Every growth agent reads it as the stable
 * prefix of its prompt (core/growth/knowledge.ts), with each fact's status.
 */
export interface ProductKnowledge {
  id: string;
  productId: string;
  what: Fact | null;
  targetUsers: Fact[];
  problems: Fact[];
  benefits: Fact[];
  features: Fact[];
  differentiators: Fact[];
  useCases: Fact[];
  pricing: Fact[];
  /** Evidence and proof: numbers, customers, testimonials the product can point to. */
  proof: Fact[];
  questions: OpenQuestion[];
  brandVoice: BrandVoice | null;
  contextVersion: number;
  updatedAt: Date;
}

// --- Market knowledge -------------------------------------------------------

export interface SourceRef {
  url: string;
  title: string;
}

export const INSIGHT_KINDS = [
  "pain",
  "phrase",
  "complaint",
  "desired_feature",
  "unmet_need",
  "trend",
  "community",
  "search_demand",
  "gap",
  "competitor_move",
] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

/**
 * One finding about the market. `grounded` says whether it was read off a
 * source fetched during the run — as opposed to what a model already believed,
 * which is kept, but never shown as though someone had checked it.
 */
export interface MarketInsight {
  id: string;
  productId: string;
  runId: string;
  kind: InsightKind;
  statement: string;
  /** How users themselves put it — the words to borrow in a post. */
  userPhrases: string[];
  sources: SourceRef[];
  grounded: boolean;
  createdAt: Date;
}

export interface Competitor {
  id: string;
  productId: string;
  runId: string;
  name: string;
  url: string | null;
  pricing: string;
  positioning: string;
  targetAudience: string;
  features: string[];
  messaging: string;
  xHandle: string | null;
  contentStrategy: string;
  strengths: string[];
  weaknesses: string[];
  differentiation: string;
  sources: SourceRef[];
  /** Its own homepage was fetched and read during this run. */
  verified: boolean;
  /**
   * What their homepage said when last read — compared daily by the watch
   * step (core/growth/watch.ts) to notice when they change their pitch.
   */
  snapshot: CompetitorSnapshot | null;
  snapshotAt: Date | null;
  createdAt: Date;
}

export interface CompetitorSnapshot {
  title: string | null;
  description: string | null;
  headings: string[];
  prices: string[];
  ctas: string[];
}

// --- Audience & positioning -------------------------------------------------

export const SEGMENT_STATUSES = ["hypothesis", "validated", "rejected"] as const;
export type SegmentStatus = (typeof SEGMENT_STATUSES)[number];

/**
 * A kind of person worth aiming at — a hypothesis until results say
 * otherwise. `evidence` lists the market findings it was drawn from, and
 * `confidence` is counted from them, not asserted.
 */
export interface Segment {
  id: string;
  productId: string;
  runId: string;
  rank: number;
  name: string;
  role: string;
  companySize: string;
  technicalLevel: string;
  /** When they meet the problem: the moment that makes it urgent. */
  situation: string;
  problem: string;
  pain: string;
  /** What they are trying to get done, beyond removing the pain. */
  motivation: string;
  currentSolutions: string[];
  /** Why this segment fits this product. */
  fitReason: string;
  channels: string[];
  keywords: string[];
  /** Phrases this person would actually write on X — the search terms. */
  xPhrases: string[];
  /** Ids of the MarketInsights this segment rests on. */
  evidence: string[];
  confidence: Confidence;
  status: SegmentStatus;
  createdAt: Date;
}

export interface PositioningBecause {
  text: string;
  status: FactStatus;
}

/** For [target] who [problem], [product] is [solution]. Unlike [alternatives], because [differentiators]. */
export interface PositioningStatement {
  segmentId: string;
  segmentName: string;
  /** One sentence, for headlines. */
  oneLiner: string;
  forWhom: string;
  problem: string;
  product: string;
  alternatives: string[];
  because: PositioningBecause[];
}

export interface Positioning extends PositioningStatement {
  id: string;
  productId: string;
  runId: string;
  createdAt: Date;
}

// --- Strategy ---------------------------------------------------------------

export const POST_TYPES = [
  "educational",
  "problem_awareness",
  "product_demo",
  "feature",
  "before_after",
  "case_study",
  "founder_story",
  "build_in_public",
  "question",
  "contrarian",
  "comparison",
  "tutorial",
  "launch",
  "product_update",
] as const;
export type PostType = (typeof POST_TYPES)[number];

export interface ContentPillar {
  name: string;
  /** Share of posts, 0–100; the pillars of one strategy sum to 100. */
  share: number;
  description: string;
  postTypes: PostType[];
}

/** One focus channel; the rest wait, each with the condition for starting it. */
export interface StrategyChannel {
  name: string;
  role: "focus" | "later";
  rationale: string;
  startWhen: string;
}

export interface StrategyChange {
  what: string;
  because: string;
}

export interface MarketingStrategy {
  id: string;
  productId: string;
  runId: string | null;
  version: number;
  segmentId: string | null;
  segmentName: string;
  positioning: PositioningStatement;
  coreMessage: string;
  supportingMessages: string[];
  pillars: ContentPillar[];
  channels: StrategyChannel[];
  acquisition: string[];
  conversion: string[];
  retentionReferral: string[];
  rationale: string;
  /** What this version changed from the last, and which result made it change. */
  changes: StrategyChange[];
  /** "planner" drafted it from research; "revision" rewrote it from learnings. */
  origin: "planner" | "revision";
  createdAt: Date;
}

// --- Hypotheses & learnings -------------------------------------------------

export const HYPOTHESIS_DIMENSIONS = ["pain", "audience", "message", "format"] as const;
export type HypothesisDimension = (typeof HYPOTHESIS_DIMENSIONS)[number];

export const HYPOTHESIS_STATUSES = ["testing", "supported", "refuted", "inconclusive", "retired"] as const;
export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number];
export type Verdict = "supported" | "refuted" | "inconclusive";

export interface GroupRates {
  engagementRate: number | null;
  clickRate: number | null;
  signupRate: number | null;
}

/** Counted in code from the posts written for a hypothesis (core/growth/hypotheses.ts). */
export interface HypothesisResult extends GroupRates {
  posts: number;
  measuredPosts: number;
  impressions: number | null;
  engagements: number | null;
  visits: number;
  signups: number | null;
  baseline: GroupRates & { posts: number };
  /** Relative difference from the baseline, e.g. 0.4 = 40% better. */
  lift: number | null;
  verdict: Verdict;
  confidence: Confidence;
  /** Why the verdict is what it is — including "not enough numbers yet". */
  reason: string;
  evaluatedAt: Date;
}

/**
 * A claim about what will work, small enough to be tested by a handful of
 * posts. The posts written for it carry its id; comparing them with the posts
 * written for the other hypotheses is the experiment.
 */
export interface Hypothesis {
  id: string;
  productId: string;
  strategyVersion: number;
  statement: string;
  dimension: HypothesisDimension;
  /** The pain / message / audience being tested, in a few words. */
  subject: string;
  /** Why we think it might be true. */
  basis: string;
  /** What we would see if it is. */
  expected: string;
  /** Ids of the MarketInsights it was drawn from. */
  basisInsights: string[];
  targetPosts: number;
  status: HypothesisStatus;
  result: HypothesisResult | null;
  /** A learning has been written for the verdict. */
  learned: boolean;
  createdAt: Date;
  concludedAt: Date | null;
}

export const LEARNING_KINDS = ["pain", "audience", "message", "format", "channel", "timing", "other"] as const;
export type LearningKind = (typeof LEARNING_KINDS)[number];

/**
 * Marketing knowledge specific to this product: what results showed. The
 * asset that grows with use — every new strategy is written against the active
 * ones, and a newer finding on the same subject supersedes the older.
 */
export interface Learning {
  id: string;
  productId: string;
  hypothesisId: string | null;
  kind: LearningKind;
  direction: "works" | "fails" | "unclear";
  statement: string;
  /** Why the result came out this way. */
  explanation: string;
  confidence: Confidence;
  evidence: {
    posts: number;
    impressions: number | null;
    engagements: number | null;
    visits: number;
    signups: number | null;
    lift: number | null;
  };
  source: "experiment" | "owner";
  status: "active" | "superseded";
  createdAt: Date;
}

// --- Execution & measurement ------------------------------------------------

export const OPPORTUNITY_SOURCES = ["x", "hackernews", "web", "manual"] as const;
export type OpportunitySource = (typeof OPPORTUNITY_SOURCES)[number];

export const OPPORTUNITY_STATUSES = ["new", "drafted", "replied", "dismissed"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

/** A public conversation where someone may need this product, and why we think so. */
export interface Opportunity {
  id: string;
  productId: string;
  runId: string | null;
  source: OpportunitySource;
  /** Unique per (productId, source): the same thread is never listed twice. */
  externalId: string;
  url: string;
  author: string;
  text: string;
  postedAt: Date | null;
  relevance: number;
  reasons: string[];
  intent: "seeking_solution" | "complaint" | "question" | "discussion";
  segmentName: string | null;
  recommendedAction: "reply" | "content" | "watch";
  status: OpportunityStatus;
  createdAt: Date;
}

export interface PostMetrics {
  impressions: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  bookmarks: number | null;
  profileVisits: number | null;
  linkClicks: number | null;
  source: "x_api" | "manual";
}

/** idea → draft → approved → published. An idea is a topic with a date and a hypothesis, before it is written. */
export const POST_STATUSES = ["idea", "draft", "approved", "published", "rejected", "failed"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** A post or a reply, from idea to what it did once it was out. */
export interface Post {
  id: string;
  productId: string;
  runId: string | null;
  kind: "post" | "reply";
  postType: PostType;
  pillar: string | null;
  /** The hypothesis this post is written to test. Null for replies and one-off posts. */
  hypothesisId: string | null;
  /** The idea, in a line, before the post is written. */
  topic: string | null;
  hook: string;
  body: string;
  cta: string;
  /** Exactly what would be sent. */
  text: string;
  /**
   * What the agent first wrote, kept when a person edits `text` before
   * approving. The difference between the two is the clearest statement of
   * their preferences there is, and Agent Memory (core/growth/memory.ts)
   * shows it to the next drafts.
   */
  draftText: string | null;
  /**
   * What the author must prepare before posting — a comparison screenshot, a
   * demo clip. The agent writes a post that stands without it but never
   * pretends it already exists.
   */
  assetNeeded: string | null;
  rationale: string;
  opportunityId: string | null;
  replyToUrl: string | null;
  replyToExternalId: string | null;
  /** The product link, tagged utm_content=<post id> so visits trace back here. */
  trackingUrl: string | null;
  plannedFor: string | null;
  status: PostStatus;
  dryRun: boolean;
  externalId: string | null;
  externalUrl: string | null;
  costEstimateUsd: number | null;
  error: string | null;
  decidedAt: Date | null;
  publishedAt: Date | null;
  metrics: PostMetrics | null;
  metricsAt: Date | null;
  createdAt: Date;
}

/** One entry in the Activity Log: something the agent did, in a sentence. */
export interface AgentAction {
  id: string;
  productId: string;
  runId: string | null;
  kind: string;
  summary: string;
  detail: unknown;
  createdAt: Date;
}

/**
 * Impressions → engagement → profile visits → website visits → signups →
 * activation → paid. `null` is "not measured" (no metrics, or no event named
 * for that stage) — never a zero standing in for one.
 */
export interface MeasurementFunnel {
  posts: number;
  impressions: number | null;
  engagements: number | null;
  profileVisits: number | null;
  websiteVisitors: number;
  signups: number | null;
  activations: number | null;
  paid: number | null;
}

/** A period's review: what the numbers were, why, and what to do. */
export interface AnalyticsReport {
  id: string;
  productId: string;
  runId: string | null;
  windowStart: Date;
  windowEnd: Date;
  funnel: MeasurementFunnel;
  headline: string;
  why: string[];
  nextActions: string[];
  learningIds: string[];
  createdAt: Date;
}

export const APPROVAL_MODES = ["manual", "assisted", "autonomous"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

/** Guardrails for everything that goes out. One per product, keyed by its id. */
export interface GrowthPolicy {
  id: string;
  productId: string;
  approvalMode: ApprovalMode;
  maxPostsPerDay: number;
  maxRepliesPerDay: number;
  minRelevance: number;
  blockKeywords: string[];
  competitorMentions: "never" | "neutral" | "allowed";
  /** 1 = never mention the product unasked, 5 = mention it whenever it fits. */
  promotionalIntensity: number;
  /** Hours in Asia/Tokyo, 0–23; equal values mean no quiet hours. */
  quietHoursStart: number;
  quietHoursEnd: number;
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
  growthRuns: GrowthRun;
  growthGoals: GrowthGoal;
  productKnowledge: ProductKnowledge;
  marketInsights: MarketInsight;
  competitors: Competitor;
  segments: Segment;
  positionings: Positioning;
  hypotheses: Hypothesis;
  learnings: Learning;
  strategies: MarketingStrategy;
  opportunities: Opportunity;
  posts: Post;
  agentActions: AgentAction;
  analyticsReports: AnalyticsReport;
  growthPolicies: GrowthPolicy;
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
  "growthRuns",
  "growthGoals",
  "productKnowledge",
  "marketInsights",
  "competitors",
  "segments",
  "positionings",
  "hypotheses",
  "learnings",
  "strategies",
  "opportunities",
  "posts",
  "agentActions",
  "analyticsReports",
  "growthPolicies",
] as const satisfies readonly CollectionName[];
