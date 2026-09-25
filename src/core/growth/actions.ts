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
import { renderKnowledgePrefix, requireKnowledge } from "./knowledge";
import { latestIcps } from "./latest";
import { createReplyDraft } from "./steps";
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
    { ...deps, icps: await latestIcps(productId, conn) },
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
    icpName: scored?.icpName ?? null,
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
