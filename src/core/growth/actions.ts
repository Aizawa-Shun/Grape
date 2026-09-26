import { createHash } from "node:crypto";

import { z } from "zod";

import { contextVersions } from "@/core/context/edit";
import { AppError } from "@/core/errors";
import { getProvider } from "@/core/llm";
import { assertProductOwner } from "@/core/product/ownership";
import { db, type Database } from "@/db/client";
import type { GrowthRun, Opportunity, Post, PostMetrics, Product } from "@/db/schema";

import { recordAction } from "./activity";
import { analyzeBrandVoice } from "./agents/brand-voice";
import { scoreCandidates } from "./agents/opportunity-finder";
import type { AgentDeps } from "./agents/shared";
import { answerQuestion, renderKnowledgePrefix, requireKnowledge } from "./knowledge";
import { latestSegments } from "./latest";
import { createReplyDraft, writeDrafts } from "./steps";
import { xStatusId } from "./tracking";

/**
 * What the growth screens can ask for, one function each, with the ownership
 * check at the top of every one — everything below them takes a bare id and
 * would happily act on somebody else's post.
 */

export async function ownedPost(postId: string, userId: string, conn: Database = db): Promise<Post> {
  const post = await conn.posts.get(postId);
  if (!post) throw new AppError("NOT_FOUND", `Unknown post: ${postId}`);
  await assertProductOwner(post.productId, userId);
  return post;
}

export async function ownedOpportunity(opportunityId: string, userId: string, conn: Database = db): Promise<Opportunity> {
  const opportunity = await conn.opportunities.get(opportunityId);
  if (!opportunity) throw new AppError("NOT_FOUND", `Unknown opportunity: ${opportunityId}`);
  await assertProductOwner(opportunity.productId, userId);
  return opportunity;
}

export async function ownedRun(runId: string, userId: string, conn: Database = db): Promise<GrowthRun> {
  const run = await conn.growthRuns.get(runId);
  if (!run) throw new AppError("NOT_FOUND", `Unknown run: ${runId}`);
  await assertProductOwner(run.productId, userId);
  return run;
}

async function depsFor(product: Product, conn: Database): Promise<AgentDeps> {
  const knowledge = await requireKnowledge(product.id, conn);
  const language = (await contextVersions(product.id, conn))[0]?.primaryLanguage ?? "ja";
  return { provider: await getProvider(), system: renderKnowledgePrefix(product, knowledge, language), language };
}

export const PastedOpportunitySchema = z.object({
  url: z.url().max(2000),
  text: z.string().trim().min(10).max(4000),
  author: z.string().trim().max(200).optional(),
});

/**
 * A conversation the person found themselves — with no X API, this is how an
 * X post gets in. Scored by the same model call as searched ones, and kept
 * whatever the score, because a person chose it.
 */
export async function addPastedOpportunity(
  productId: string,
  input: z.infer<typeof PastedOpportunitySchema>,
  conn: Database = db,
): Promise<Opportunity> {
  const product = await conn.products.get(productId);
  if (!product) throw new AppError("NOT_FOUND", `Unknown product: ${productId}`);
  const statusId = xStatusId(input.url);
  const source = statusId ? "x" : "manual";
  const externalId = statusId ?? createHash("sha256").update(input.url).digest("hex").slice(0, 24);

  const existing = await conn.opportunities.first({
    where: [["productId", "==", productId], ["source", "==", source], ["externalId", "==", externalId]],
  });
  if (existing) return existing;

  const deps = await depsFor(product, conn);
  const [scored] = await scoreCandidates(
    [{ source, externalId, url: input.url, author: input.author || new URL(input.url).hostname, text: input.text, postedAt: null }],
    { ...deps, segments: await latestSegments(productId, conn) },
  );
  const opportunity = await conn.opportunities.insert({
    productId,
    source,
    externalId,
    url: input.url,
    author: input.author || new URL(input.url).hostname,
    text: input.text,
    relevance: scored?.relevance ?? 0,
    reasons: scored?.reasons ?? ["関連度を判断できませんでした"],
    intent: scored?.intent ?? "discussion",
    segmentName: scored?.segmentName ?? null,
    recommendedAction: scored?.recommendedAction ?? "watch",
  });
  await recordAction({ productId, kind: "opportunity.pasted", summary: `あなたが見つけた会話を追加しました（関連度${opportunity.relevance}%）` }, conn);
  return opportunity;
}

export async function draftReply(opportunity: Opportunity, conn: Database = db): Promise<Post> {
  const product = await conn.products.get(opportunity.productId);
  if (!product) throw new AppError("NOT_FOUND", `Unknown product: ${opportunity.productId}`);
  const knowledge = await requireKnowledge(product.id, conn);
  const post = await createReplyDraft(product, opportunity.id, knowledge, await depsFor(product, conn), conn);
  await recordAction({ productId: product.id, kind: "reply.drafted", summary: `返信案を作りました（${opportunity.author} への返信）` }, conn);
  return post;
}

export async function dismissOpportunity(opportunity: Opportunity, conn: Database = db): Promise<void> {
  await conn.opportunities.update(opportunity.id, { status: "dismissed" });
}

const count = z.union([z.coerce.number().int().min(0), z.literal("").transform(() => null), z.null()]).optional();

export const ManualMetricsSchema = z.object({
  impressions: count,
  likes: count,
  replies: count,
  reposts: count,
  quotes: count,
  bookmarks: count,
  profileVisits: count,
  linkClicks: count,
});

/** Numbers read off X's own analytics by hand — the path with no API read access. */
export async function saveManualMetrics(post: Post, input: z.infer<typeof ManualMetricsSchema>, conn: Database = db): Promise<Post> {
  if (post.status !== "published") throw new AppError("CONFLICT", "Only published posts have results", { hint: "公開した投稿だけに数字を入力できます。" });
  const metrics: PostMetrics = {
    impressions: input.impressions ?? null,
    likes: input.likes ?? null,
    replies: input.replies ?? null,
    reposts: input.reposts ?? null,
    quotes: input.quotes ?? null,
    bookmarks: input.bookmarks ?? null,
    profileVisits: input.profileVisits ?? null,
    linkClicks: input.linkClicks ?? null,
    source: "manual",
  };
  const updated = await conn.posts.update(post.id, { metrics, metricsAt: new Date() });
  return { ...post, ...updated } as Post;
}

export const BrandVoiceInputSchema = z.object({
  samples: z.array(z.string().trim().min(10).max(2000)).min(2).max(10),
});

export async function saveBrandVoice(productId: string, samples: string[], conn: Database = db) {
  await requireKnowledge(productId, conn);
  const voice = await analyzeBrandVoice(samples, await getProvider());
  await conn.productKnowledge.update(productId, { brandVoice: voice, updatedAt: new Date() });
  await recordAction({ productId, kind: "brand_voice.learned", summary: `あなたの文体を${samples.length}件のサンプルから学びました` }, conn);
  return voice;
}

/**
 * "投稿のネタにする": a conversation that is better answered in public than in
 * a reply — the question many people share. The post is written about the
 * problem, never about the person: nothing that would identify them is
 * quoted, and it takes no day in the week's plan.
 */
export async function draftPostFromOpportunity(opportunity: Opportunity, conn: Database = db): Promise<Post> {
  const product = await conn.products.get(opportunity.productId);
  if (!product) throw new AppError("NOT_FOUND", `Unknown product: ${opportunity.productId}`);
  const topic =
    "見込み客のこの悩みに、公開の投稿として答える（投稿者を特定できる引用・名前は出さない）: " +
    opportunity.text.replace(/\s+/g, " ").slice(0, 400);
  // An idea first — the row's id is the post's tracking id — then written up.
  // No plannedFor and no hypothesis: a one-off, outside the experiment and the week's plan.
  const idea = await conn.posts.insert({
    productId: product.id,
    kind: "post",
    status: "idea",
    postType: opportunity.intent === "question" ? "educational" : "problem_awareness",
    topic,
    hook: "",
    body: "",
    cta: "",
    text: "",
    rationale: "",
    opportunityId: null,
  });
  const [post] = await writeDrafts(product, [idea], await depsFor(product, conn), conn);
  if (!post) {
    await conn.posts.delete(idea.id);
    throw new AppError("LLM_BAD_OUTPUT", "No post was written for the opportunity");
  }
  await conn.opportunities.update(opportunity.id, { status: "drafted" });
  await recordAction({ productId: product.id, kind: "post.drafted_from_opportunity", summary: "見込み客の会話から投稿案を作りました" }, conn);
  return post;
}

// --- The owner's side of the brain ------------------------------------------

export const AnswerSchema = z.object({ questionId: z.string().min(1).max(100), answer: z.string().trim().min(1).max(1000) });

/** An open question answered: the answer becomes the owner's own fact. */
export async function answerKnowledgeQuestion(productId: string, input: z.infer<typeof AnswerSchema>, conn: Database = db) {
  const knowledge = await answerQuestion(productId, input.questionId, input.answer, conn);
  await recordAction({ productId, kind: "knowledge.answered", summary: "Grapeの質問に答えました（事実として記録）" }, conn);
  return knowledge;
}

export const OwnerLearningSchema = z.object({
  statement: z.string().trim().min(4).max(400),
  direction: z.enum(["works", "fails"]),
});

/**
 * Something the owner already knows about their market — "a discount never
 * worked for us". Kept beside what the experiments found, marked as theirs,
 * and read by every strategy the same way.
 */
export async function addOwnerLearning(productId: string, input: z.infer<typeof OwnerLearningSchema>, conn: Database = db) {
  const learning = await conn.learnings.insert({
    productId,
    kind: "other",
    direction: input.direction,
    statement: input.statement,
    explanation: "オーナー本人の経験",
    confidence: "medium",
    evidence: { posts: 0, impressions: null, engagements: null, visits: 0, signups: null, lift: null },
    source: "owner",
  });
  await recordAction({ productId, kind: "learning.owner", summary: `あなたの知見を学びに加えました: ${input.statement}` }, conn);
  return learning;
}

/** A learning that no longer holds: kept in history, no longer used. */
export async function retireLearning(productId: string, learningId: string, conn: Database = db): Promise<void> {
  const learning = await conn.learnings.get(learningId);
  if (!learning || learning.productId !== productId) throw new AppError("NOT_FOUND", `Unknown learning: ${learningId}`);
  await conn.learnings.update(learningId, { status: "superseded" });
}

/** Stops testing a hypothesis the owner does not want tested. Its planned ideas go with it. */
export async function retireHypothesis(productId: string, hypothesisId: string, conn: Database = db): Promise<void> {
  const hypothesis = await conn.hypotheses.get(hypothesisId);
  if (!hypothesis || hypothesis.productId !== productId) throw new AppError("NOT_FOUND", `Unknown hypothesis: ${hypothesisId}`);
  await conn.hypotheses.update(hypothesisId, { status: "retired", concludedAt: new Date(), learned: true });
  const ideas = await conn.posts.find({ where: [["productId", "==", productId], ["hypothesisId", "==", hypothesisId]] });
  for (const idea of ideas) if (idea.status === "idea") await conn.posts.update(idea.id, { status: "rejected", error: "仮説の検証をやめたため" });
  await recordAction({ productId, kind: "hypothesis.retired", summary: `仮説「${hypothesis.subject}」の検証をやめました` }, conn);
}

export const EventNamesSchema = z.object({
  signupEventName: z.string().trim().max(200),
  paidEventName: z.string().trim().max(200),
});

/** Which tracked events mean "signed up" and "paid" — what lets the funnel count past the visit. */
export async function saveEventNames(productId: string, input: z.infer<typeof EventNamesSchema>, conn: Database = db) {
  await conn.products.update(productId, {
    signupEventName: input.signupEventName || null,
    paidEventName: input.paidEventName || null,
  });
}
