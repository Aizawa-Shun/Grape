import { contextVersions } from "@/core/context/edit";
import { AppError } from "@/core/errors";
import { getProvider, llmAvailable, type LLMProvider } from "@/core/llm";
import { db, type Database } from "@/db/client";
import type { Fact, GrowthRun, GrowthStepKind, Hypothesis, KnowledgeTopic, Post, Product, ProductKnowledge } from "@/db/schema";
import { by, firstBy } from "@/db/sort";

import { runAudienceAnalyzer } from "./agents/audience-analyzer";
import { runCompetitorAnalyzer } from "./agents/competitor-analyzer";
import { runContentGenerator, type ContentSlot } from "./agents/content-generator";
import { HYPOTHESES_PER_ROUND, POSTS_PER_HYPOTHESIS, runExperimentDesigner, runIdeaGenerator } from "./agents/experiment-designer";
import { runLearner } from "./agents/learner";
import { runMarketResearcher } from "./agents/market-researcher";
import { runOpportunityFinder } from "./agents/opportunity-finder";
import { runPositioningAnalyzer } from "./agents/positioning-analyzer";
import { knowledgeWithoutModel, runProductAnalyzer, type ProductKnowledgeDraft } from "./agents/product-analyzer";
import { runReplyGenerator } from "./agents/reply-generator";
import { runReviewer } from "./agents/reviewer";
import type { AgentDeps } from "./agents/shared";
import { runStrategyPlanner, runStrategyRevision } from "./agents/strategy-planner";
import { attributionFor, eventConfigOf, EMPTY_ATTRIBUTION } from "./attribution";
import { LIST_TOPICS, mergeQuestions, type SourcePage } from "./facts";
import { evaluateHypothesis, type PostOutcome } from "./hypotheses";
import { renderKnowledgePrefix, requireKnowledge } from "./knowledge";
import {
  activeGoal,
  activeLearnings,
  activeStrategy,
  latestCompetitors,
  latestInsights,
  latestPositioning,
  latestReport,
  latestSegments,
  testingHypotheses,
} from "./latest";
import { buildFunnel } from "./measurement";
import { buildAgentMemory, renderMemory } from "./memory";
import { getPolicy, tokyoDay } from "./policy";
import { approvePost } from "./publish";
import { StepSkipped } from "./runs";
import { DEFAULT_POSTS_PER_DAY, dayAfter, interleave, planDates } from "./schedule";
import { conversationSources, createHackerNewsSource, fetchXMetrics, getWebResearcher, xReadAuth } from "./sources";
import { fetchPublicPage, type PublicPage } from "./sources/page";
import { createSuggestSource, type SuggestSource } from "./sources/suggest";
import type { ConversationSource } from "./sources/types";
import type { WebResearcher } from "./sources/web";
import { trackingUrl } from "./tracking";
import { watchCompetitors } from "./watch";

/**
 * What each step of the Marketing Brain's loop does against the database.
 *
 *   understand   product → market → competitors → audience → positioning
 *   decide       strategy → experiments (hypotheses) → ideas
 *   execute      content (drafts) → [review & publish, by a person] → opportunities
 *   learn        metrics → measure → learn → revise
 *
 * The agents (agents/*) are pure functions of their inputs; this is where
 * their inputs are loaded and their outputs saved, tagged with the run that
 * produced them. Each step returns one sentence for the progress screen and
 * the Activity Log.
 */

const DAY_MS = 86_400_000;
/** Ideas due within this many days are written up as drafts. Further out, they stay ideas — a draft goes stale. */
const DRAFT_DAYS_AHEAD = 2;
/** How far ahead ideas are planned: enough to see the week coming, little enough that a revision can still change it. */
const PLAN_DAYS_AHEAD = 7;
/** Opportunities below this are noise, not "low relevance" — not kept at all. */
const KEEP_RELEVANCE = 30;
/** How often the week's review is written. */
const REVIEW_EVERY_DAYS = 6;

/**
 * The outside world a step reaches: the model, the web, the conversation
 * sources. Injectable so the whole loop can run in a test against fakes;
 * each defaults to the real thing for whoever is asking.
 */
export interface StepServices {
  provider?: LLMProvider;
  web?: WebResearcher | null;
  hackerNews?: ConversationSource;
  sources?: ConversationSource[];
  fetchPage?: (url: string) => Promise<PublicPage | null>;
  suggest?: SuggestSource | null;
}

interface StepContext {
  run: GrowthRun;
  product: Product;
  conn: Database;
  now: Date;
  services: StepServices;
}

const providerOf = async (services: StepServices) => services.provider ?? (await getProvider());
const webOf = async (services: StepServices) => (services.web !== undefined ? services.web : await getWebResearcher());

async function languageOf(productId: string, conn: Database): Promise<string> {
  const latest = (await contextVersions(productId, conn))[0];
  return latest?.primaryLanguage ?? "ja";
}

async function agentDeps(product: Product, knowledge: ProductKnowledge, conn: Database, services: StepServices = {}): Promise<AgentDeps> {
  const language = await languageOf(product.id, conn);
  return { provider: await providerOf(services), system: renderKnowledgePrefix(product, knowledge, language), language };
}

async function depsFor(ctx: StepContext): Promise<{ knowledge: ProductKnowledge; deps: AgentDeps }> {
  const knowledge = await requireKnowledge(ctx.product.id, ctx.conn);
  return { knowledge, deps: await agentDeps(ctx.product, knowledge, ctx.conn, ctx.services) };
}

// --- understand -------------------------------------------------------------

/**
 * A re-analysis never throws away what the owner said. Facts they wrote or
 * confirmed stay; the model's new reading fills in around them, and a model
 * fact that repeats an owner fact is dropped. The owner's answers also close
 * the questions they answered.
 */
export function mergeWithOwner(draft: ProductKnowledgeDraft, existing: ProductKnowledge | null): ProductKnowledgeDraft {
  if (!existing) return draft;
  const owned = (facts: Fact[]) => facts.filter((fact) => fact.basis === "owner");
  const key = (fact: Fact) => fact.text.replace(/\s/g, "");
  const merged: ProductKnowledgeDraft = { ...draft };
  merged.what = existing.what?.basis === "owner" ? existing.what : draft.what;
  for (const topic of LIST_TOPICS) {
    const mine = owned(existing[topic]);
    const mineKeys = new Set(mine.map(key));
    merged[topic] = [...mine, ...draft[topic].filter((fact) => !mineKeys.has(key(fact)))];
  }
  const answered = new Set<KnowledgeTopic>(
    [...(existing.what?.basis === "owner" ? ["what" as const] : []), ...LIST_TOPICS.filter((t) => owned(existing[t]).length > 0)],
  );
  merged.questions = mergeQuestions(
    draft.questions.filter((q) => !q.id.startsWith("auto-") && !answered.has(q.topic)),
    { ...merged, id: "", productId: "", brandVoice: null, contextVersion: 0, updatedAt: new Date() },
  );
  return merged;
}

async function productStep({ product, conn, now, services }: StepContext): Promise<string> {
  const versions = await contextVersions(product.id, conn);
  const context = versions[0];
  if (!context) throw new AppError("CONFLICT", `Product ${product.id} has no context`, { hint: "サイトの読み取りが終わっていません。" });
  const analysis = versions.find((version) => version.analysis)?.analysis ?? null;

  const crawled = await conn.crawlPages.find({ where: [["productId", "==", product.id]] });
  const pages: SourcePage[] = crawled
    .filter((page) => page.status === 200 && page.text)
    .map((page) => ({ url: page.url, title: page.title, text: page.text ?? "", meta: page.meta ?? undefined }));

  const existing = await conn.productKnowledge.get(product.id);
  const read =
    (services.provider || llmAvailable()) && pages.length > 0
      ? await runProductAnalyzer({ product, context, pages }, await providerOf(services))
      : knowledgeWithoutModel(context, analysis);
  const draft = mergeWithOwner(read, existing);

  await conn.productKnowledge.set(product.id, {
    productId: product.id,
    ...draft,
    brandVoice: existing?.brandVoice ?? null,
    contextVersion: context.version,
    updatedAt: now,
  });
  const facts = [...(draft.what ? [draft.what] : []), ...LIST_TOPICS.flatMap((topic) => draft[topic])];
  const known = facts.filter((fact) => fact.status === "known").length;
  return `事実${known}件・仮説${facts.length - known}件を整理し、まだ分からないことを${draft.questions.length}件見つけました`;
}

async function marketStep(ctx: StepContext): Promise<string> {
  const { deps } = await depsFor(ctx);
  const suggest = ctx.services.suggest !== undefined ? ctx.services.suggest : createSuggestSource();
  const result = await runMarketResearcher({
    ...deps,
    web: await webOf(ctx.services),
    hackerNews: ctx.services.hackerNews ?? createHackerNewsSource(),
    suggest: suggest ?? undefined,
    productId: ctx.product.id,
  });
  for (const finding of result.findings) {
    await ctx.conn.marketInsights.insert({ productId: ctx.product.id, runId: ctx.run.id, ...finding });
  }
  const phrases = result.findings.reduce((sum, f) => sum + f.userPhrases.length, 0);
  const grounded = result.findings.filter((f) => f.grounded).length;
  return `${result.sourcesRead}件のソースを読み、${result.findings.length}件の発見（出典つき${grounded}件）と、顧客の言い回し${phrases}件を集めました${result.webUsed ? "" : "（Web検索なし）"}`;
}

async function competitorsStep(ctx: StepContext): Promise<string> {
  const { deps } = await depsFor(ctx);
  const analysis = (await contextVersions(ctx.product.id, ctx.conn)).find((v) => v.analysis)?.analysis ?? null;
  const result = await runCompetitorAnalyzer({
    ...deps,
    web: await webOf(ctx.services),
    fetchPage: ctx.services.fetchPage ?? ((url) => fetchPublicPage(url)),
    similarServices: analysis?.market.similarServices.items ?? [],
    productId: ctx.product.id,
  });
  for (const competitor of result.competitors) {
    await ctx.conn.competitors.insert({ productId: ctx.product.id, runId: ctx.run.id, ...competitor, snapshotAt: competitor.snapshot ? ctx.now : null });
  }
  for (const gap of result.gaps) {
    await ctx.conn.marketInsights.insert({ productId: ctx.product.id, runId: ctx.run.id, kind: "gap", statement: gap.statement, userPhrases: [], sources: gap.sources, grounded: gap.grounded });
  }
  const verified = result.competitors.filter((c) => c.verified).length;
  return `${result.competitors.length}社を分析しました（公式サイトを確認${verified}社）。まだ誰も訴求していない領域を${result.gaps.length}件見つけました`;
}

async function audienceStep(ctx: StepContext): Promise<string> {
  const { deps } = await depsFor(ctx);
  const [insights, competitors, learnings] = await Promise.all([
    latestInsights(ctx.product.id, ctx.conn),
    latestCompetitors(ctx.product.id, ctx.conn),
    activeLearnings(ctx.product.id, ctx.conn),
  ]);
  const segments = await runAudienceAnalyzer({ insights, competitors, learnings }, deps);
  if (segments.length === 0) throw new AppError("LLM_BAD_OUTPUT", "No segment returned");
  for (const [rank, segment] of segments.entries()) {
    await ctx.conn.segments.insert({ productId: ctx.product.id, runId: ctx.run.id, rank: rank + 1, ...segment });
  }
  const label = { high: "根拠が多い", medium: "根拠あり", low: "根拠が薄い" } as const;
  return `狙う候補を${segments.length}つに絞りました。最優先は「${segments[0].name}」（${label[segments[0].confidence]}）`;
}

async function positioningStep(ctx: StepContext): Promise<string> {
  const { knowledge, deps } = await depsFor(ctx);
  const [segment] = await latestSegments(ctx.product.id, ctx.conn);
  if (!segment) throw new StepSkipped("狙うセグメントがまだ無いので、ポジショニングを決められませんでした");
  const [competitors, insights] = await Promise.all([latestCompetitors(ctx.product.id, ctx.conn), latestInsights(ctx.product.id, ctx.conn)]);
  const statement = await runPositioningAnalyzer(
    {
      segment,
      differentiators: knowledge.differentiators,
      proof: knowledge.proof,
      competitors,
      gaps: insights.filter((i) => i.kind === "gap"),
    },
    deps,
  );
  await ctx.conn.positionings.insert({ productId: ctx.product.id, runId: ctx.run.id, ...statement });
  const assumed = statement.because.filter((b) => b.status === "assumption").length;
  return `「${statement.oneLiner}」${assumed ? `（選ばれる理由のうち${assumed}件は仮説）` : ""}`;
}

// --- decide -----------------------------------------------------------------

/** The site funnel's latest diagnosis, when there is one: what the conversion half of the strategy must answer. */
async function siteFinding(productId: string, conn: Database): Promise<string | null> {
  const diagnosis = firstBy(await conn.diagnoses.find({ where: [["productId", "==", productId]] }), by((d) => d.createdAt, "desc"));
  return diagnosis ? `いちばん人が離れている段階: ${diagnosis.bottleneckStage}。${diagnosis.summary}` : null;
}

async function strategyStep(ctx: StepContext): Promise<string> {
  const { deps } = await depsFor(ctx);
  const [segments, positioning, insights, competitors, previous, goal, learnings, finding] = await Promise.all([
    latestSegments(ctx.product.id, ctx.conn),
    latestPositioning(ctx.product.id, ctx.conn),
    latestInsights(ctx.product.id, ctx.conn),
    latestCompetitors(ctx.product.id, ctx.conn),
    activeStrategy(ctx.product.id, ctx.conn),
    activeGoal(ctx.product.id, ctx.conn),
    activeLearnings(ctx.product.id, ctx.conn),
    siteFinding(ctx.product.id, ctx.conn),
  ]);
  const segment = segments[0];
  if (!segment || !positioning) throw new StepSkipped("狙う相手とポジショニングがまだ無いので、戦略を立てられませんでした");

  const draft = await runStrategyPlanner({ goal, segment, positioning, insights, competitors, learnings, siteFinding: finding }, deps);
  const { segmentId, segmentName, oneLiner, forWhom, problem, product: productLine, alternatives, because } = positioning;
  await ctx.conn.strategies.insert({
    productId: ctx.product.id,
    runId: ctx.run.id,
    version: (previous?.version ?? 0) + 1,
    segmentId: segment.id,
    segmentName: segment.name,
    positioning: { segmentId, segmentName, oneLiner, forWhom, problem, product: productLine, alternatives, because },
    origin: "planner",
    ...draft,
  });
  const later = draft.channels.filter((c) => c.role === "later").map((c) => c.name).join("・");
  return `中心メッセージ「${draft.coreMessage}」。まずXに集中します${later ? `（${later}は条件を満たしてから）` : ""}`;
}

async function experimentsStep(ctx: StepContext): Promise<string> {
  const [strategy, testing] = await Promise.all([activeStrategy(ctx.product.id, ctx.conn), testingHypotheses(ctx.product.id, ctx.conn)]);
  if (!strategy) throw new StepSkipped("戦略がまだ無いので、仮説を立てられませんでした");
  const need = HYPOTHESES_PER_ROUND - testing.length;
  if (need <= 0) throw new StepSkipped(`検証中の仮説が${testing.length}件あるので、その結果を待ちます`);

  const { deps } = await depsFor(ctx);
  const [segments, insights, learnings, all] = await Promise.all([
    latestSegments(ctx.product.id, ctx.conn),
    latestInsights(ctx.product.id, ctx.conn),
    activeLearnings(ctx.product.id, ctx.conn),
    ctx.conn.hypotheses.find({ where: [["productId", "==", ctx.product.id]] }),
  ]);
  const segment = segments.find((s) => s.id === strategy.segmentId) ?? segments[0];
  if (!segment) throw new StepSkipped("狙うセグメントがまだありません");

  const drafts = await runExperimentDesigner(
    {
      segment,
      positioning: strategy.positioning,
      coreMessage: strategy.coreMessage,
      insights,
      learnings,
      testing: testing.map((h) => h.statement),
      concluded: all.filter((h) => h.status !== "testing").map((h) => h.statement),
      need,
    },
    deps,
  );
  for (const draft of drafts) {
    await ctx.conn.hypotheses.insert({
      productId: ctx.product.id,
      strategyVersion: strategy.version,
      targetPosts: POSTS_PER_HYPOTHESIS,
      ...draft,
    });
  }
  if (drafts.length === 0) throw new StepSkipped("新しい仮説が出ませんでした（検証済みのものと同じだったため）。次の実行でもう一度立てます");
  return `検証する仮説を${drafts.length}件立てました: ${drafts.map((d) => `「${d.subject}」`).join("・")}`;
}

/** Posts not yet out: the backlog a new idea would join. */
function isPending(post: Post): boolean {
  return post.status === "idea" || post.status === "draft" || (post.status === "approved" && !post.publishedAt);
}

async function ideasStep(ctx: StepContext): Promise<string> {
  const [strategy, testing, posts, policy] = await Promise.all([
    activeStrategy(ctx.product.id, ctx.conn),
    testingHypotheses(ctx.product.id, ctx.conn),
    ctx.conn.posts.find({ where: [["productId", "==", ctx.product.id]] }),
    getPolicy(ctx.product.id, ctx.conn),
  ]);
  if (!strategy || testing.length === 0) throw new StepSkipped("検証中の仮説が無いので、ネタは出しません");

  const own = posts.filter((p) => p.kind === "post");
  const horizon = dayAfter(ctx.now, PLAN_DAYS_AHEAD);
  const planned = own.filter((p) => isPending(p) && p.plannedFor && p.plannedFor <= horizon).length;
  const perDay = Math.min(policy.maxPostsPerDay || DEFAULT_POSTS_PER_DAY, DEFAULT_POSTS_PER_DAY);
  const room = Math.max(0, PLAN_DAYS_AHEAD * perDay - planned);
  if (room === 0) throw new StepSkipped("1週間先まで予定が埋まっています");

  // Each hypothesis gets what it still lacks toward its target, shared out in turns within the week's room.
  const lacking = testing.map((h) => ({
    hypothesis: h,
    lacking: Math.max(0, h.targetPosts - own.filter((p) => p.hypothesisId === h.id && p.status !== "rejected").length),
  }));
  const shares = new Map<string, number>();
  let left = room;
  while (left > 0 && lacking.some(({ hypothesis, lacking: l }) => (shares.get(hypothesis.id) ?? 0) < l)) {
    for (const { hypothesis, lacking: l } of lacking) {
      if (left > 0 && (shares.get(hypothesis.id) ?? 0) < l) {
        shares.set(hypothesis.id, (shares.get(hypothesis.id) ?? 0) + 1);
        left -= 1;
      }
    }
  }
  if ([...shares.values()].every((n) => n === 0)) throw new StepSkipped("仮説ごとの投稿はそろっています。結果を待ちます");

  const { deps } = await depsFor(ctx);
  const [insights, memory] = await Promise.all([latestInsights(ctx.product.id, ctx.conn), buildAgentMemory(ctx.product.id, ctx.conn)]);
  const ideas = await runIdeaGenerator(
    {
      hypotheses: testing.map((h) => ({ id: h.id, statement: h.statement, subject: h.subject, expected: h.expected, need: shares.get(h.id) ?? 0 })),
      pillars: strategy.pillars,
      coreMessage: strategy.coreMessage,
      customerPhrases: insights.flatMap((i) => i.userPhrases),
      existingTopics: own.map((p) => p.topic).filter((t): t is string => Boolean(t)),
      memory: renderMemory(memory, "post"),
    },
    deps,
  );

  const taken: Record<string, number> = {};
  for (const post of own) if (isPending(post) && post.plannedFor) taken[post.plannedFor] = (taken[post.plannedFor] ?? 0) + 1;
  const ordered = interleave(testing.map((h) => ideas.filter((idea) => idea.hypothesisId === h.id)));
  const dates = planDates(ordered.length, ctx.now, perDay, taken);
  for (const [index, idea] of ordered.entries()) {
    await ctx.conn.posts.insert({
      productId: ctx.product.id,
      runId: ctx.run.id,
      kind: "post",
      status: "idea",
      postType: idea.postType,
      pillar: idea.pillar,
      hypothesisId: idea.hypothesisId,
      topic: idea.topic,
      hook: "",
      body: "",
      cta: "",
      text: "",
      rationale: "",
      plannedFor: dates[index],
    });
  }
  return `${ordered.length}件の投稿のネタを、${dates[0] ?? ""}から1日1本の予定で並べました`;
}

// --- execute ----------------------------------------------------------------

/**
 * Writes ideas up as drafts. The idea row already exists — its id is what the
 * post's tracking link carries — so writing it is an update: text, link,
 * rationale, and the status moving from idea to draft.
 */
export async function writeDrafts(product: Product, ideas: Post[], deps: AgentDeps, conn: Database): Promise<Post[]> {
  if (ideas.length === 0) return [];
  const knowledge = await requireKnowledge(product.id, conn);
  const [insights, segments, competitors, policy, memory, strategy, hypotheses] = await Promise.all([
    latestInsights(product.id, conn),
    latestSegments(product.id, conn),
    latestCompetitors(product.id, conn),
    getPolicy(product.id, conn),
    buildAgentMemory(product.id, conn),
    activeStrategy(product.id, conn),
    conn.hypotheses.find({ where: [["productId", "==", product.id]] }),
  ]);
  const hypothesisOf = new Map<string, Hypothesis>(hypotheses.map((h) => [h.id, h]));
  const slots: ContentSlot[] = ideas.map((idea) => {
    const hypothesis = idea.hypothesisId ? hypothesisOf.get(idea.hypothesisId) : undefined;
    return {
      id: idea.id,
      date: idea.plannedFor ?? tokyoDay(new Date()),
      pillar: idea.pillar ?? "",
      postType: idea.postType,
      topic: idea.topic ?? "",
      hypothesis: hypothesis ? { statement: hypothesis.statement, subject: hypothesis.subject } : null,
    };
  });

  const drafts = await runContentGenerator(
    {
      slots,
      coreMessage: strategy?.coreMessage ?? null,
      brandVoice: knowledge.brandVoice,
      userPhrases: insights.flatMap((i) => i.userPhrases),
      icpNames: segments.map((s) => s.name),
      memory: renderMemory(memory, "post"),
      policy,
      competitorNames: competitors.map((c) => c.name),
    },
    deps,
  );

  const written: Post[] = [];
  for (const draft of drafts) {
    const link = draft.includeLink ? trackingUrl(product.url, draft.slotId) : null;
    const before = ideas.find((idea) => idea.id === draft.slotId)!;
    const changes = {
      status: "draft" as const,
      hook: draft.hook,
      body: draft.body,
      cta: draft.cta,
      text: link ? `${draft.text}\n${link}` : draft.text,
      rationale: draft.rationale,
      assetNeeded: draft.assetNeeded || null,
      trackingUrl: link,
    };
    await conn.posts.update(draft.slotId, changes);
    written.push({ ...before, ...changes });
  }
  return written;
}

async function contentStep(ctx: StepContext): Promise<string> {
  const policy = await getPolicy(ctx.product.id, ctx.conn);
  // Manual mode: nothing is drafted unasked. A run the person started still drafts.
  if (policy.approvalMode === "manual" && ctx.run.kind === "daily") {
    throw new StepSkipped("承認モードが「手動」なので、案の自動作成はしません");
  }
  const { knowledge, deps } = await depsFor(ctx);
  const due = dayAfter(ctx.now, DRAFT_DAYS_AHEAD);
  const ideas = (await ctx.conn.posts.find({ where: [["productId", "==", ctx.product.id], ["status", "==", "idea"]] }))
    .filter((post) => post.plannedFor && post.plannedFor <= due)
    .sort(by((post) => post.plannedFor ?? ""));

  const drafts = await writeDrafts(ctx.product, ideas, deps, ctx.conn);
  const replies = await draftReplies(ctx, knowledge, deps, policy.maxRepliesPerDay);
  if (drafts.length === 0 && replies === 0) throw new StepSkipped("書く予定の投稿も、返信する会話も、今はありません");
  return `投稿の下書き${drafts.length}件、返信案${replies}件を作りました`;
}

/** Reply drafts for the most relevant new conversations, up to the day's reply limit. */
async function draftReplies(ctx: StepContext, knowledge: ProductKnowledge, deps: AgentDeps, limit: number): Promise<number> {
  const policy = await getPolicy(ctx.product.id, ctx.conn);
  const candidates = (await ctx.conn.opportunities.find({ where: [["productId", "==", ctx.product.id], ["status", "==", "new"]] }))
    .filter((o) => o.recommendedAction === "reply" && o.relevance >= policy.minRelevance)
    .sort(by((o) => o.relevance, "desc"))
    .slice(0, limit);
  for (const opportunity of candidates) await createReplyDraft(ctx.product, opportunity.id, knowledge, deps, ctx.conn, ctx.run.id);
  return candidates.length;
}

export async function createReplyDraft(
  product: Product,
  opportunityId: string,
  knowledge: ProductKnowledge,
  deps: AgentDeps,
  conn: Database = db,
  runId: string | null = null,
): Promise<Post> {
  const opportunity = await conn.opportunities.get(opportunityId);
  if (!opportunity || opportunity.productId !== product.id) throw new AppError("NOT_FOUND", `Unknown opportunity: ${opportunityId}`);
  const policy = await getPolicy(product.id, conn);
  const memory = renderMemory(await buildAgentMemory(product.id, conn), "reply");
  const draft = await runReplyGenerator({ opportunity, brandVoice: knowledge.brandVoice, policy, memory }, deps);
  const post = await conn.posts.insert({
    productId: product.id,
    runId,
    kind: "reply",
    postType: "question",
    hook: "",
    body: draft.reply,
    cta: draft.bridge,
    text: draft.text,
    rationale: draft.approach + (draft.mentionsProduct ? "（製品に軽く触れています）" : "（製品には触れていません）"),
    opportunityId: opportunity.id,
    replyToUrl: opportunity.url,
    replyToExternalId: opportunity.source === "x" ? opportunity.externalId : null,
  });
  await conn.opportunities.update(opportunity.id, { status: "drafted" });
  return post;
}

async function opportunitiesStep(ctx: StepContext): Promise<string> {
  const { deps } = await depsFor(ctx);
  const [segments, policy, existing] = await Promise.all([
    latestSegments(ctx.product.id, ctx.conn),
    getPolicy(ctx.product.id, ctx.conn),
    ctx.conn.opportunities.find({ where: [["productId", "==", ctx.product.id]] }),
  ]);
  if (segments.length === 0) throw new StepSkipped("狙うセグメントがまだ無いので探せませんでした");

  const result = await runOpportunityFinder({
    ...deps,
    sources: ctx.services.sources ?? conversationSources(),
    web: await webOf(ctx.services),
    segments,
    seen: new Set(existing.map((o) => `${o.source}:${o.externalId}`)),
    blockKeywords: policy.blockKeywords,
    productId: ctx.product.id,
  });

  let kept = 0;
  for (const opportunity of result.opportunities) {
    if (opportunity.relevance < KEEP_RELEVANCE) continue;
    await ctx.conn.opportunities.insert({ productId: ctx.product.id, runId: ctx.run.id, ...opportunity });
    kept += 1;
  }
  const high = result.opportunities.filter((o) => o.relevance >= policy.minRelevance).length;
  const where = result.searched.map((s) => `${s.source}${s.error ? "(失敗)" : ` ${s.found}件`}`).join("・") || "なし";
  return `${result.candidates}件の会話を調べ（${where}）、${kept}件を記録しました。関連度${policy.minRelevance}%以上は${high}件`;
}

async function watchStep(ctx: StepContext): Promise<string> {
  const competitors = (await latestCompetitors(ctx.product.id, ctx.conn)).filter((c) => c.url && c.snapshot);
  if (competitors.length === 0) throw new StepSkipped("見張れる競合（公式サイトを読めた競合）がまだありません");
  const result = await watchCompetitors(competitors, ctx.services.fetchPage ?? ((url) => fetchPublicPage(url)), ctx.run.id, ctx.conn, ctx.now);
  const unreachable = result.unreachable ? `（${result.unreachable}社は読めず）` : "";
  if (result.moves.length === 0) return `${result.checked}社のサイトを確認しました。変化はありません${unreachable}`;
  return `${result.checked}社を確認し、${result.moves.map((m) => m.competitor.name).join("・")}に変化がありました${unreachable}`;
}

// --- learn ------------------------------------------------------------------

const METRICS_WINDOW_DAYS = 30;

async function publishedPosts(productId: string, conn: Database): Promise<Post[]> {
  return (await conn.posts.find({ where: [["productId", "==", productId], ["status", "==", "published"]] })).filter(
    (post) => post.kind === "post" && post.publishedAt,
  );
}

async function metricsStep({ product, conn, now }: StepContext): Promise<string> {
  const cutoff = now.getTime() - METRICS_WINDOW_DAYS * DAY_MS;
  const posts = (await publishedPosts(product.id, conn)).filter((p) => p.externalId && p.publishedAt!.getTime() >= cutoff);
  if (posts.length === 0) throw new StepSkipped("Xから数字を取れる公開済みの投稿がまだありません");
  const auth = xReadAuth();
  if (!auth) throw new StepSkipped("Xの読み取り用の認証情報が無いので、Xの数字は手入力かサイト側の数字だけで判断します");
  const metrics = await fetchXMetrics(posts.map((p) => p.externalId!), auth);
  for (const post of posts) {
    const found = metrics.get(post.externalId!);
    // A person's hand-entered numbers are not overwritten by an API that returned less.
    if (found && post.metrics?.source !== "manual") await conn.posts.update(post.id, { metrics: found, metricsAt: now });
  }
  return `${metrics.size}件の投稿の表示・反応をXから取得しました`;
}

/**
 * Measurement (spec §8): every hypothesis under test is re-evaluated against
 * what its posts did, in code; and once a week, the week's funnel is reviewed.
 */
async function measureStep(ctx: StepContext): Promise<string> {
  const { product, conn, now } = ctx;
  const posts = await publishedPosts(product.id, conn);
  if (posts.length === 0) throw new StepSkipped("公開した投稿がまだありません");
  const config = eventConfigOf(product);
  const attribution = await attributionFor(product.id, posts, conn);
  const outcomes: PostOutcome[] = posts.map((post) => ({ post, attribution: attribution.get(post.id) ?? EMPTY_ATTRIBUTION }));

  const testing = await testingHypotheses(product.id, conn);
  const concluded: string[] = [];
  for (const hypothesis of testing) {
    const result = evaluateHypothesis(hypothesis.id, outcomes, config.signup !== null, now);
    const decided = result.verdict !== "inconclusive";
    // Written for twice its target and still no difference: that is the answer.
    const exhausted = !decided && result.posts >= hypothesis.targetPosts * 2;
    await conn.hypotheses.update(hypothesis.id, {
      result,
      ...(decided || exhausted ? { status: decided ? result.verdict : "inconclusive", concludedAt: now } : {}),
    });
    if (decided || exhausted) concluded.push(hypothesis.subject);
  }

  let reviewed = false;
  const last = await latestReport(product.id, conn);
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const recent = posts.filter((p) => p.publishedAt! >= weekAgo);
  if (recent.length > 0 && (!last || now.getTime() - last.createdAt.getTime() >= REVIEW_EVERY_DAYS * DAY_MS)) {
    const funnel = buildFunnel(recent, attribution, config);
    const { deps } = await depsFor(ctx);
    const review = await runReviewer(
      { funnel, hypotheses: await conn.hypotheses.find({ where: [["productId", "==", product.id]] }), siteFinding: await siteFinding(product.id, conn) },
      deps,
    );
    await conn.analyticsReports.insert({
      productId: product.id,
      runId: ctx.run.id,
      windowStart: weekAgo,
      windowEnd: now,
      funnel,
      headline: review.headline,
      why: review.why,
      nextActions: review.nextActions,
      learningIds: [],
    });
    reviewed = true;
  }

  const parts = [`検証中の仮説${testing.length}件を評価しました`];
  if (concluded.length) parts.push(`結論が出たもの: ${concluded.map((c) => `「${c}」`).join("・")}`);
  if (reviewed) parts.push("今週の振り返りを書きました");
  return parts.join("。");
}

async function learnStep(ctx: StepContext): Promise<string> {
  const { product, conn } = ctx;
  const pending = (await conn.hypotheses.find({ where: [["productId", "==", product.id]] })).filter(
    (h) => !h.learned && h.result && (h.status === "supported" || h.status === "refuted" || h.status === "inconclusive"),
  );
  if (pending.length === 0) throw new StepSkipped("新しく結論の出た仮説はありません");

  const { deps } = await depsFor(ctx);
  const posts = await publishedPosts(product.id, conn);
  const attribution = await attributionFor(product.id, posts, conn);
  const score = (post: Post) => {
    const a = attribution.get(post.id) ?? EMPTY_ATTRIBUTION;
    return a.signups * 100 + a.visitors * 10 + (post.metrics?.likes ?? 0);
  };

  const written: string[] = [];
  for (const hypothesis of pending) {
    const mine = posts.filter((p) => p.hypothesisId === hypothesis.id).sort((a, b) => score(b) - score(a));
    const learning = await runLearner(
      { hypothesis, result: hypothesis.result!, best: mine.slice(0, 2), worst: mine.slice(-2).reverse() },
      deps,
    );
    const r = hypothesis.result!;
    await conn.learnings.insert({
      productId: product.id,
      hypothesisId: hypothesis.id,
      kind: learning.kind,
      direction: learning.direction,
      statement: learning.statement,
      explanation: learning.explanation,
      confidence: r.confidence,
      evidence: { posts: r.posts, impressions: r.impressions, engagements: r.engagements, visits: r.visits, signups: r.signups, lift: r.lift },
    });
    await conn.hypotheses.update(hypothesis.id, { learned: true });
    written.push(learning.statement);
  }
  return `学びを${written.length}件記録しました: ${written.map((w) => `「${w}」`).join("・")}`;
}

/**
 * Learning → strategy (spec §9): the strategy is revised when there are new,
 * decided learnings since it was written — and only in what they support.
 */
async function reviseStep(ctx: StepContext): Promise<string> {
  const { product, conn } = ctx;
  const [strategy, learnings] = await Promise.all([activeStrategy(product.id, conn), activeLearnings(product.id, conn)]);
  if (!strategy) throw new StepSkipped("まだ戦略がありません");
  const fresh = learnings.filter((l) => l.createdAt > strategy.createdAt && l.direction !== "unclear");
  if (fresh.length === 0) throw new StepSkipped("戦略を変えるほどの新しい学びはありません");

  const { deps } = await depsFor(ctx);
  const ordered = [...fresh, ...learnings.filter((l) => !fresh.includes(l))];
  const revision = await runStrategyRevision({ current: strategy, positioning: strategy.positioning, learnings: ordered }, deps);
  if (!revision) throw new StepSkipped("学びを読みましたが、戦略を変える根拠にはなりませんでした");

  await conn.strategies.insert({
    productId: product.id,
    runId: ctx.run.id,
    version: strategy.version + 1,
    segmentId: strategy.segmentId,
    segmentName: strategy.segmentName,
    positioning: strategy.positioning,
    coreMessage: revision.coreMessage || strategy.coreMessage,
    supportingMessages: revision.supportingMessages.length ? revision.supportingMessages : strategy.supportingMessages,
    pillars: revision.pillars.length ? revision.pillars : strategy.pillars,
    channels: strategy.channels,
    acquisition: revision.acquisition.length ? revision.acquisition : strategy.acquisition,
    conversion: strategy.conversion,
    retentionReferral: strategy.retentionReferral,
    rationale: revision.rationale,
    changes: revision.changes,
    origin: "revision",
  });
  return `学びをもとに戦略を改訂しました: ${revision.changes.map((c) => c.what).join(" / ")}`;
}

// --- act on the owner's rules -----------------------------------------------

async function autopilotStep({ product, conn, now }: StepContext): Promise<string> {
  const policy = await getPolicy(product.id, conn);
  if (policy.approvalMode !== "autonomous") throw new StepSkipped("承認モードが「自律」ではないので、実行はあなたの承認を待ちます");

  const today = tokyoDay(now);
  const drafts = (await conn.posts.find({ where: [["productId", "==", product.id], ["status", "==", "draft"]] })).filter(
    (post) => post.kind === "reply" || post.plannedFor === today,
  );

  let sent = 0;
  const held: string[] = [];
  for (const draft of drafts) {
    try {
      await approvePost(draft.id, { automatic: true, now, database: conn });
      sent += 1;
    } catch (error) {
      held.push(error instanceof AppError && error.hint ? error.hint : "送信できませんでした");
    }
  }
  const reasons = [...new Set(held)].join(" ");
  return `ルールの範囲で${sent}件を実行しました${held.length ? `。${held.length}件は保留: ${reasons}` : ""}`;
}

const STEPS: Record<GrowthStepKind, (context: StepContext) => Promise<string>> = {
  product: productStep,
  market: marketStep,
  competitors: competitorsStep,
  audience: audienceStep,
  positioning: positioningStep,
  strategy: strategyStep,
  experiments: experimentsStep,
  ideas: ideasStep,
  content: contentStep,
  opportunities: opportunitiesStep,
  watch: watchStep,
  metrics: metricsStep,
  measure: measureStep,
  learn: learnStep,
  revise: reviseStep,
  autopilot: autopilotStep,
};

export async function executeStep(
  run: GrowthRun,
  kind: GrowthStepKind,
  conn: Database = db,
  now: Date = new Date(),
  services: StepServices = {},
): Promise<string> {
  const product = await conn.products.get(run.productId);
  if (!product) throw new AppError("NOT_FOUND", `Unknown product: ${run.productId}`);
  return STEPS[kind]({ run, product, conn, now, services });
}
