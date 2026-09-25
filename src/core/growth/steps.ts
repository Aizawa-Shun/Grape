import { contextVersions } from "@/core/context/edit";
import { AppError } from "@/core/errors";
import { getProvider, llmAvailable, type LLMProvider } from "@/core/llm";
import { db, type Database } from "@/db/client";
import type { GrowthRun, GrowthStepKind, PlanSlot, Post, Product, ProductKnowledge } from "@/db/schema";
import { by } from "@/db/sort";

import { runCompetitorAnalyzer } from "./agents/competitor-analyzer";
import { runContentGenerator } from "./agents/content-generator";
import { runIcpAnalyzer } from "./agents/icp-analyzer";
import { runMarketResearcher } from "./agents/market-researcher";
import { runOpportunityFinder } from "./agents/opportunity-finder";
import { runPerformanceAnalyzer } from "./agents/performance-analyzer";
import { knowledgeWithoutModel, runProductAnalyzer } from "./agents/product-analyzer";
import { runReplyGenerator } from "./agents/reply-generator";
import type { AgentDeps } from "./agents/shared";
import { runStrategyPlanner } from "./agents/strategy-planner";
import { attributionFor } from "./attribution";
import { renderKnowledgePrefix, requireKnowledge } from "./knowledge";
import { buildAgentMemory, renderMemory } from "./memory";
import { activeGoal, activeStrategy, latestCompetitors, latestIcps, latestInsights, latestReport } from "./latest";
import { mixOf, reweightPillars, typeStats, MIN_POSTS_TO_LEARN, type PostPerformance } from "./performance";
import { planWeek } from "./mix";
import { getPolicy, tokyoDay } from "./policy";
import { approvePost } from "./publish";
import { StepSkipped } from "./runs";
import { conversationSources, createHackerNewsSource, fetchXMetrics, getWebResearcher, xReadAuth } from "./sources";
import { fetchPublicPage, type PublicPage } from "./sources/page";
import type { ConversationSource } from "./sources/types";
import type { WebResearcher } from "./sources/web";
import { trackingUrl } from "./tracking";

/**
 * What each step of a growth run does against the database. The agents
 * (agents/*) are pure functions of their inputs; this is where their inputs
 * are loaded and their outputs saved, tagged with the run that produced them.
 * Each step returns one sentence for the progress screen and the Activity Log.
 */

const DAY_MS = 86_400_000;
/** How many days of the plan are drafted ahead. More would go stale before they are posted. */
const DRAFT_DAYS_AHEAD = 3;
/** Opportunities below this are noise, not "low relevance" — not kept at all. */
const KEEP_RELEVANCE = 30;

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

// --- product ----------------------------------------------------------------

async function productStep({ run, product, conn, now, services }: StepContext): Promise<string> {
  const versions = await contextVersions(product.id, conn);
  const context = versions[0];
  if (!context) throw new AppError("CONFLICT", `Product ${product.id} has no context`, { hint: "サイトの読み取りが終わっていません。" });
  const analysis = versions.find((version) => version.analysis)?.analysis ?? null;

  const existing = await conn.productKnowledge.get(product.id);
  // A person's correction outranks a re-analysis. They can still ask for one
  // explicitly (api/growth/[productId]/knowledge DELETE), which clears the mark.
  if (existing?.editedByHuman && run.kind !== "initial") {
    throw new StepSkipped("あなたが確認した内容をそのまま使います");
  }

  const draft = services.provider || llmAvailable()
    ? await runProductAnalyzer({ product, context, analysis }, await providerOf(services))
    : knowledgeWithoutModel(context, analysis);

  await conn.productKnowledge.set(product.id, {
    productId: product.id,
    ...draft,
    brandVoice: existing?.brandVoice ?? null,
    contextVersion: context.version,
    editedByHuman: false,
    updatedAt: now,
  });
  return `${draft.marketingAngles.length}個のマーケティングの切り口と${draft.useCases.length}件の利用シーンを整理しました`;
}

// --- research ---------------------------------------------------------------

async function marketStep({ run, product, conn, services }: StepContext): Promise<string> {
  const knowledge = await requireKnowledge(product.id, conn);
  const deps = await agentDeps(product, knowledge, conn, services);
  const result = await runMarketResearcher({
    ...deps,
    web: await webOf(services),
    hackerNews: services.hackerNews ?? createHackerNewsSource(),
    productId: product.id,
  });
  for (const finding of result.findings) {
    await conn.marketInsights.insert({ productId: product.id, runId: run.id, ...finding });
  }
  const grounded = result.findings.filter((f) => f.grounded).length;
  return `${result.sourcesRead}件のソースを読み、${result.findings.length}件の発見を記録しました（うち出典つき${grounded}件${result.webUsed ? "" : "・Web検索なし"}）`;
}

async function competitorsStep({ run, product, conn, services }: StepContext): Promise<string> {
  const knowledge = await requireKnowledge(product.id, conn);
  const deps = await agentDeps(product, knowledge, conn, services);
  const analysis = (await contextVersions(product.id, conn)).find((v) => v.analysis)?.analysis ?? null;
  const result = await runCompetitorAnalyzer({
    ...deps,
    web: await webOf(services),
    fetchPage: services.fetchPage ?? ((url) => fetchPublicPage(url)),
    similarServices: analysis?.market.similarServices.items ?? [],
    productId: product.id,
  });
  for (const competitor of result.competitors) {
    await conn.competitors.insert({ productId: product.id, runId: run.id, ...competitor });
  }
  for (const gap of result.gaps) {
    await conn.marketInsights.insert({ productId: product.id, runId: run.id, kind: "gap", statement: gap.statement, userPhrases: [], sources: gap.sources, grounded: gap.grounded });
  }
  const verified = result.competitors.filter((c) => c.verified).length;
  return `${result.competitors.length}社を分析しました（公式サイトを確認${verified}社）。未訴求の領域を${result.gaps.length}件見つけました`;
}

async function icpStep({ run, product, conn, services }: StepContext): Promise<string> {
  const knowledge = await requireKnowledge(product.id, conn);
  const deps = await agentDeps(product, knowledge, conn, services);
  const [insights, competitors] = await Promise.all([latestInsights(product.id, conn), latestCompetitors(product.id, conn)]);
  const icps = await runIcpAnalyzer({ insights, competitors }, deps);
  if (icps.length === 0) throw new AppError("LLM_BAD_OUTPUT", "No ICP returned");
  for (const [rank, icp] of icps.entries()) {
    await conn.icps.insert({ productId: product.id, runId: run.id, rank: rank + 1, ...icp });
  }
  return `ICPを${icps.length}件特定しました: ${icps.map((icp) => icp.name).join(" / ")}`;
}

async function strategyStep({ run, product, conn, services }: StepContext): Promise<string> {
  const knowledge = await requireKnowledge(product.id, conn);
  const deps = await agentDeps(product, knowledge, conn, services);
  const [icps, insights, competitors, previous, goal, report] = await Promise.all([
    latestIcps(product.id, conn),
    latestInsights(product.id, conn),
    latestCompetitors(product.id, conn),
    activeStrategy(product.id, conn),
    activeGoal(product.id, conn),
    latestReport(product.id, conn),
  ]);
  const draft = await runStrategyPlanner(
    { goal, icps, insights, competitors, learning: report ? report.recommendation : null },
    deps,
  );
  await conn.strategies.insert({ productId: product.id, runId: run.id, version: (previous?.version ?? 0) + 1, origin: "planner", ...draft });
  return `戦略を立てました。柱: ${draft.pillars.map((p) => `${p.name} ${p.share}%`).join(" / ")}`;
}

// --- opportunities ----------------------------------------------------------

async function opportunitiesStep({ run, product, conn, services }: StepContext): Promise<string> {
  const knowledge = await requireKnowledge(product.id, conn);
  const deps = await agentDeps(product, knowledge, conn, services);
  const [icps, policy, existing] = await Promise.all([
    latestIcps(product.id, conn),
    getPolicy(product.id, conn),
    conn.opportunities.find({ where: [["productId", "==", product.id]] }),
  ]);
  if (icps.length === 0) throw new StepSkipped("ICPがまだ無いので探せませんでした");

  const result = await runOpportunityFinder({
    ...deps,
    sources: services.sources ?? conversationSources(),
    web: await webOf(services),
    icps,
    seen: new Set(existing.map((o) => `${o.source}:${o.externalId}`)),
    blockKeywords: policy.blockKeywords,
    productId: product.id,
  });

  let kept = 0;
  for (const opportunity of result.opportunities) {
    if (opportunity.relevance < KEEP_RELEVANCE) continue;
    await conn.opportunities.insert({ productId: product.id, runId: run.id, ...opportunity });
    kept += 1;
  }
  const high = result.opportunities.filter((o) => o.relevance >= policy.minRelevance).length;
  const where = result.searched.map((s) => `${s.source}${s.error ? "(失敗)" : ` ${s.found}件`}`).join("・") || "なし";
  return `${result.candidates}件の会話を調べ（${where}）、${kept}件を記録しました。関連度${policy.minRelevance}%以上は${high}件`;
}

// --- content ----------------------------------------------------------------

async function contentStep({ run, product, conn, now, services }: StepContext): Promise<string> {
  const policy = await getPolicy(product.id, conn);
  // Manual mode: nothing is drafted unasked. A run the person started still drafts.
  if (policy.approvalMode === "manual" && run.kind === "daily") {
    throw new StepSkipped("承認モードが「手動」なので、案の自動作成はしません");
  }
  const knowledge = await requireKnowledge(product.id, conn);
  const strategy = await activeStrategy(product.id, conn);
  if (!strategy) throw new StepSkipped("戦略がまだ無いので投稿案を作れませんでした");
  const deps = await agentDeps(product, knowledge, conn, services);

  const posts = await conn.posts.find({ where: [["productId", "==", product.id]] });
  const taken = new Set(posts.filter((p) => p.kind === "post" && p.status !== "rejected" && p.plannedFor).map((p) => p.plannedFor));
  const slots = strategy.weeklyPlan
    .map((slot) => ({ ...slot, date: tokyoDay(new Date(now.getTime() + slot.day * DAY_MS)) }))
    .filter((slot) => slot.day < DRAFT_DAYS_AHEAD && !taken.has(slot.date));

  const drafts = await writePosts(product, knowledge, slots, deps, conn, { runId: run.id });
  const replies = await draftReplies({ run, product, conn, now, services }, knowledge, deps, policy.maxRepliesPerDay);
  return `投稿案${drafts.length}件、返信案${replies}件を作りました`;
}

/**
 * Writes posts for the given slots and saves them as drafts — shared by the
 * daily plan and by "投稿のネタにする" on a conversation. `plan: false` keeps
 * a one-off post out of the week's plan, so it does not take a day's slot.
 */
export async function writePosts(
  product: Product,
  knowledge: ProductKnowledge,
  slots: (PlanSlot & { date: string })[],
  deps: AgentDeps,
  conn: Database,
  options: { runId?: string | null; plan?: boolean } = {},
): Promise<Post[]> {
  if (slots.length === 0) return [];
  const [insights, icps, competitors, policy, memory] = await Promise.all([
    latestInsights(product.id, conn),
    latestIcps(product.id, conn),
    latestCompetitors(product.id, conn),
    getPolicy(product.id, conn),
    buildAgentMemory(product.id, conn),
  ]);

  const drafts = await runContentGenerator(
    {
      slots,
      brandVoice: knowledge.brandVoice,
      userPhrases: insights.flatMap((i) => i.userPhrases),
      icpNames: icps.map((i) => i.name),
      memory: renderMemory(memory, "post"),
      policy,
      competitorNames: competitors.map((c) => c.name),
    },
    deps,
  );

  const saved: Post[] = [];
  for (const draft of drafts) {
    const id = crypto.randomUUID();
    const link = draft.includeLink ? trackingUrl(product.url, id) : null;
    saved.push(
      await conn.posts.insert({
        id,
        productId: product.id,
        runId: options.runId ?? null,
        kind: "post",
        postType: draft.postType,
        pillar: draft.pillar,
        hook: draft.hook,
        body: draft.body,
        cta: draft.cta,
        text: link ? `${draft.text}\n${link}` : draft.text,
        rationale: draft.rationale,
        trackingUrl: link,
        plannedFor: options.plan === false ? null : draft.plannedFor,
      }),
    );
  }
  return saved;
}

/** Reply drafts for the most relevant new conversations, up to the day's reply limit. */
async function draftReplies(
  { run, product, conn }: StepContext,
  knowledge: ProductKnowledge,
  deps: AgentDeps,
  limit: number,
): Promise<number> {
  const policy = await getPolicy(product.id, conn);
  const candidates = (await conn.opportunities.find({ where: [["productId", "==", product.id], ["status", "==", "new"]] }))
    .filter((o) => o.recommendedAction === "reply" && o.relevance >= policy.minRelevance)
    .sort(by((o) => o.relevance, "desc"))
    .slice(0, limit);

  let count = 0;
  for (const opportunity of candidates) {
    await createReplyDraft(product, opportunity.id, knowledge, deps, conn, run.id);
    count += 1;
  }
  return count;
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

// --- learning ---------------------------------------------------------------

const METRICS_WINDOW_DAYS = 30;

async function recentPublished(productId: string, now: Date, conn: Database): Promise<Post[]> {
  const cutoff = now.getTime() - METRICS_WINDOW_DAYS * DAY_MS;
  return (await conn.posts.find({ where: [["productId", "==", productId], ["status", "==", "published"]] })).filter(
    (post) => post.publishedAt && post.publishedAt.getTime() >= cutoff,
  );
}

async function metricsStep({ product, conn, now }: StepContext): Promise<string> {
  const posts = (await recentPublished(product.id, now, conn)).filter((p) => p.externalId);
  if (posts.length === 0) throw new StepSkipped("数字を取る公開済みの投稿がまだありません");
  const auth = xReadAuth();
  if (!auth) throw new StepSkipped("Xの読み取り用の認証情報が無いので、サイト側の訪問と登録だけで分析します");
  const metrics = await fetchXMetrics(posts.map((p) => p.externalId!), auth);
  for (const post of posts) {
    const found = metrics.get(post.externalId!);
    if (found) await conn.posts.update(post.id, { metrics: found, metricsAt: now });
  }
  return `${metrics.size}件の投稿の表示・反応をXから取得しました`;
}

async function performanceStep({ run, product, conn, now, services }: StepContext): Promise<string> {
  const posts = (await recentPublished(product.id, now, conn)).filter((p) => p.kind === "post");
  if (posts.length === 0) throw new StepSkipped("分析する公開済みの投稿がまだありません");

  const attribution = await attributionFor(product.id, posts, conn);
  const performances: PostPerformance[] = posts.map((post) => ({
    post,
    attribution: attribution.get(post.id) ?? { visits: 0, visitors: 0, signups: 0 },
  }));
  const stats = typeStats(performances);

  const knowledge = await requireKnowledge(product.id, conn);
  const narrative =
    posts.length >= 2
      ? await runPerformanceAnalyzer({ stats, performances }, await agentDeps(product, knowledge, conn, services))
      : {
          worked: [],
          failed: [],
          recommendation: "公開した投稿がまだ1本なので、傾向はまだ言えません。計画どおり投稿を続けてください。",
          nextActions: [],
        };

  // GrowthStrategist: re-weight the mix in code from the same stats.
  const strategy = await activeStrategy(product.id, conn);
  const pillars = strategy ? reweightPillars(strategy, stats) : null;
  const mixBefore = strategy ? mixOf(strategy.pillars) : {};
  const changed = strategy && pillars && JSON.stringify(mixOf(pillars)) !== JSON.stringify(mixBefore);
  if (strategy && pillars && changed) {
    const topics: Record<string, string[]> = {};
    for (const slot of strategy.weeklyPlan) (topics[slot.pillar] ??= []).push(slot.topic);
    await conn.strategies.insert({
      productId: product.id,
      runId: run.id,
      version: strategy.version + 1,
      positioning: strategy.positioning,
      messaging: strategy.messaging,
      pillars,
      channels: strategy.channels,
      shortTerm: narrative.nextActions.length ? narrative.nextActions : strategy.shortTerm,
      midTerm: strategy.midTerm,
      weeklyPlan: planWeek(pillars, topics),
      rationale: `結果に合わせて配分を調整した: ${narrative.recommendation}`,
      origin: "learning",
    });
  }

  const windowStart = new Date(Math.min(...posts.map((p) => p.publishedAt!.getTime())));
  await conn.analyticsReports.insert({
    productId: product.id,
    runId: run.id,
    windowStart,
    windowEnd: now,
    stats,
    ...narrative,
    mixBefore,
    mixAfter: changed && pillars ? mixOf(pillars) : mixBefore,
  });

  const visits = performances.reduce((s, p) => s + p.attribution.visits, 0);
  const signups = performances.reduce((s, p) => s + p.attribution.signups, 0);
  const tail = changed
    ? "。結果に合わせて投稿の配分を変えました"
    : posts.length < MIN_POSTS_TO_LEARN
      ? `。配分の調整は${MIN_POSTS_TO_LEARN}本以上たまってから行います`
      : "";
  return `${posts.length}本の投稿を分析しました（サイト訪問${visits}・登録${signups}）${tail}`;
}

// --- autopilot --------------------------------------------------------------

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
  icp: icpStep,
  strategy: strategyStep,
  opportunities: opportunitiesStep,
  content: contentStep,
  metrics: metricsStep,
  performance: performanceStep,
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
