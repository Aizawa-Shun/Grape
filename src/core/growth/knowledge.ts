import { z } from "zod";

import { getLatestContext } from "@/core/context/edit";
import { AppError } from "@/core/errors";
import { db, type Database } from "@/db/client";
import type { BrandVoice, Product, ProductKnowledge } from "@/db/schema";

import { activeStrategy, latestCompetitors, latestIcps, latestInsights } from "./latest";

/**
 * The Product Knowledge Base (spec §6): what every growth agent knows about
 * the product before it is asked anything.
 *
 * Two layers. The stored `productKnowledge` document is the product itself —
 * summary, problem, USP, angles — written by ProductAnalyzer and correctable
 * by a person. Around it, `loadKnowledgeBase` assembles everything the loop has
 * learned since (ICPs, competitors, insights, the strategy) into the one JSON
 * shape the spec describes, so an agent is never re-deriving the product from
 * scratch.
 *
 * `renderKnowledgePrefix` is what goes in front of every growth prompt. Like
 * context/snapshot.ts it depends only on the stored document — no clock, no
 * run ids — so a day's worth of agent calls share one cached prefix.
 */

export interface KnowledgeBase {
  product: {
    id: string;
    name: string;
    url: string;
    summary: string;
    language: string;
  };
  target_users: string[];
  problems: string[];
  solutions: string[];
  features: string[];
  usp: string[];
  use_cases: string[];
  pricing: string;
  competitors: { name: string; url: string | null; positioning: string; verified: boolean }[];
  marketing_angles: { name: string; description: string }[];
  icps: { name: string; problem: string; pain: string; keywords: string[] }[];
  insights: { kind: string; statement: string; grounded: boolean }[];
  strategy: { positioning: string; messaging: string[]; pillars: { name: string; share: number }[] } | null;
  brand_voice: BrandVoice | null;
}

export async function getKnowledge(productId: string, conn: Database = db): Promise<ProductKnowledge | null> {
  return conn.productKnowledge.get(productId);
}

export async function requireKnowledge(productId: string, conn: Database = db): Promise<ProductKnowledge> {
  const knowledge = await getKnowledge(productId, conn);
  if (!knowledge) {
    throw new AppError("CONFLICT", `Product ${productId} has no knowledge base yet`, {
      hint: "先にプロダクトの理解（最初の分析）を完了させてください。",
    });
  }
  return knowledge;
}

export async function loadKnowledgeBase(productId: string, conn: Database = db): Promise<KnowledgeBase> {
  const product = await conn.products.get(productId);
  if (!product) throw new AppError("NOT_FOUND", `Unknown product: ${productId}`);
  const knowledge = await requireKnowledge(productId, conn);
  const [icps, competitors, insights, strategy, context] = await Promise.all([
    latestIcps(productId, conn),
    latestCompetitors(productId, conn),
    latestInsights(productId, conn),
    activeStrategy(productId, conn),
    getLatestContext(productId, conn),
  ]);

  return {
    product: {
      id: product.id,
      name: product.name,
      url: product.url,
      summary: knowledge.summary,
      language: context?.primaryLanguage ?? "ja",
    },
    target_users: [knowledge.targetUser],
    problems: [knowledge.problem],
    solutions: [knowledge.solution],
    features: knowledge.features,
    usp: knowledge.usp,
    use_cases: knowledge.useCases,
    pricing: knowledge.pricing,
    competitors: competitors.map((c) => ({ name: c.name, url: c.url, positioning: c.positioning, verified: c.verified })),
    marketing_angles: knowledge.marketingAngles,
    icps: icps.map((icp) => ({ name: icp.name, problem: icp.problem, pain: icp.pain, keywords: icp.keywords })),
    insights: insights.map((insight) => ({ kind: insight.kind, statement: insight.statement, grounded: insight.grounded })),
    strategy: strategy
      ? {
          positioning: strategy.positioning,
          messaging: strategy.messaging,
          pillars: strategy.pillars.map((pillar) => ({ name: pillar.name, share: pillar.share })),
        }
      : null,
    brand_voice: knowledge.brandVoice,
  };
}

/** The stable prompt prefix. See the module comment for why nothing volatile may enter it. */
export function renderKnowledgePrefix(product: Product, knowledge: ProductKnowledge, language: string): string {
  const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
  return [
    "# 対象プロダクト（Product Knowledge Base）",
    "",
    `名前: ${product.name}`,
    `URL: ${product.url}`,
    `利用者が使う言語: ${language}`,
    "",
    "## 概要",
    knowledge.summary,
    "",
    "## 解決する課題",
    knowledge.problem,
    "",
    "## 解決のしかた",
    knowledge.solution,
    "",
    "## 想定ユーザー",
    knowledge.targetUser,
    "",
    "## USP（他ではなくこれを選ぶ理由）",
    list(knowledge.usp),
    "",
    "## 主な機能",
    list(knowledge.features),
    "",
    "## 利用シーン",
    list(knowledge.useCases),
    "",
    "## 料金",
    knowledge.pricing,
    "",
    "## マーケティングの切り口",
    list(knowledge.marketingAngles.map((angle) => `${angle.name}: ${angle.description}`)),
    "",
    knowledge.editedByHuman
      ? "注記: この内容はプロダクトの作者が確認・修正済み。事実として扱ってよい。"
      : "注記: この内容はサイトからの自動分析で、作者の確認を経ていない。断定しすぎないこと。",
  ].join("\n");
}

/** What a person may correct from the knowledge page. Brand voice has its own form. */
export const KnowledgeEditSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  problem: z.string().trim().min(1).max(2000),
  solution: z.string().trim().min(1).max(2000),
  targetUser: z.string().trim().min(1).max(2000),
  usp: z.array(z.string().trim().min(1).max(300)).max(10),
  useCases: z.array(z.string().trim().min(1).max(300)).max(10),
  features: z.array(z.string().trim().min(1).max(300)).max(20),
  pricing: z.string().trim().max(1000),
  marketingAngles: z
    .array(z.object({ name: z.string().trim().min(1).max(60), description: z.string().trim().min(1).max(400) }))
    .max(12),
});
export type KnowledgeEdit = z.infer<typeof KnowledgeEditSchema>;

export async function saveKnowledgeEdit(
  productId: string,
  edit: KnowledgeEdit,
  conn: Database = db,
): Promise<ProductKnowledge> {
  const existing = await requireKnowledge(productId, conn);
  const updated = await conn.productKnowledge.update(productId, {
    ...edit,
    editedByHuman: true,
    updatedAt: new Date(),
  });
  return updated ? { ...existing, ...updated } : existing;
}
