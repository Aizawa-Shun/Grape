import { z } from "zod";

import { AppError } from "@/core/errors";
import { db, type Database } from "@/db/client";
import type { Fact, KnowledgeTopic, Product, ProductKnowledge } from "@/db/schema";

import { applyAnswer, LIST_TOPICS, mergeQuestions, normalizeFact, TOPIC_LABELS } from "./facts";

/**
 * The Product Knowledge (spec §3): what Grape knows about the product it is
 * marketing, fact by fact, each one known or assumed — and what it does not
 * know yet, kept as questions for the owner.
 *
 * Every growth agent reads it as the stable prefix of its prompt
 * (`renderKnowledgePrefix`), with each fact's status in front of it, so no
 * agent can mistake an assumption for something the site said.
 */

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

const MARK = { known: "確認済み", assumption: "仮説" } as const;

function renderFacts(title: string, facts: Fact[]): string[] {
  if (facts.length === 0) return [];
  return ["", `## ${title}`, ...facts.map((fact) => `- [${MARK[fact.status]}] ${fact.text}`)];
}

/**
 * The stable prompt prefix. Depends only on the stored rows — no clock, no
 * run ids — so a day's agent calls share one cached prefix (the same rule as
 * context/snapshot.ts).
 */
export function renderKnowledgePrefix(product: Product, knowledge: ProductKnowledge, language: string): string {
  const lines = [
    "# 対象プロダクト（Product Knowledge）",
    "",
    `名前: ${product.name}`,
    `URL: ${product.url}`,
    `利用者が使う言語: ${language}`,
    "",
    "読み方: [確認済み] はサイトの原文かオーナー本人の言葉で裏付けがある。[仮説] は推測であり、事実として書かない。",
    ...(knowledge.what ? ["", `## ${TOPIC_LABELS.what}`, `- [${MARK[knowledge.what.status]}] ${knowledge.what.text}`] : []),
    ...LIST_TOPICS.flatMap((topic) => renderFacts(TOPIC_LABELS[topic], knowledge[topic])),
  ];
  if (knowledge.questions.length > 0) {
    lines.push(
      "",
      "## まだ分かっていないこと",
      ...knowledge.questions.map((q) => `- ${q.question}${q.guess ? `（現時点の推測: ${q.guess}）` : ""}`),
      "分かっていないことは、あるものとして書かない。",
    );
  }
  return lines.join("\n");
}

const FactSchema = z.object({
  text: z.string().trim().min(1).max(600),
  status: z.enum(["known", "assumption"]),
  basis: z.enum(["site", "owner", "inference"]),
  evidence: z.array(z.object({ url: z.string().max(2000), quote: z.string().max(1000) })).max(5),
});

/** What a person may change from the product page: every fact, and nothing structural. */
export const KnowledgeEditSchema = z.object({
  what: FactSchema.nullable(),
  targetUsers: z.array(FactSchema).max(12),
  problems: z.array(FactSchema).max(12),
  benefits: z.array(FactSchema).max(12),
  features: z.array(FactSchema).max(24),
  differentiators: z.array(FactSchema).max(12),
  useCases: z.array(FactSchema).max(12),
  pricing: z.array(FactSchema).max(12),
  proof: z.array(FactSchema).max(12),
});
export type KnowledgeEdit = z.infer<typeof KnowledgeEditSchema>;

/**
 * Saves an edit. Each fact passes through `normalizeFact`, so a person can
 * confirm an assumption (it becomes their word, `owner`) or rewrite one, but
 * cannot make a fact claim a site source it has no quote for. Questions the
 * edit has since answered by adding a fact on the topic are not re-asked.
 */
export async function saveKnowledgeEdit(productId: string, edit: KnowledgeEdit, conn: Database = db): Promise<ProductKnowledge> {
  const existing = await requireKnowledge(productId, conn);
  const next: ProductKnowledge = {
    ...existing,
    what: edit.what ? normalizeFact(edit.what) : null,
    targetUsers: edit.targetUsers.map(normalizeFact),
    problems: edit.problems.map(normalizeFact),
    benefits: edit.benefits.map(normalizeFact),
    features: edit.features.map(normalizeFact),
    differentiators: edit.differentiators.map(normalizeFact),
    useCases: edit.useCases.map(normalizeFact),
    pricing: edit.pricing.map(normalizeFact),
    proof: edit.proof.map(normalizeFact),
    updatedAt: new Date(),
  };
  // A question the person has answered by writing the fact themselves is closed;
  // the checklist's are recomputed from what is now known.
  const openFromModel = existing.questions.filter((q) => !q.id.startsWith("auto-") && !hasOwnerFact(next, q.topic));
  next.questions = mergeQuestions(openFromModel, next);
  await conn.productKnowledge.set(productId, next);
  return next;
}

function hasOwnerFact(knowledge: ProductKnowledge, topic: KnowledgeTopic): boolean {
  const facts = topic === "what" ? (knowledge.what ? [knowledge.what] : []) : knowledge[topic];
  return facts.some((fact) => fact.basis === "owner");
}

export async function answerQuestion(productId: string, questionId: string, answer: string, conn: Database = db): Promise<ProductKnowledge> {
  const existing = await requireKnowledge(productId, conn);
  const answered = applyAnswer(existing, questionId, answer);
  if (answered === existing) throw new AppError("NOT_FOUND", `No open question ${questionId}`);
  const next: ProductKnowledge = { ...answered, updatedAt: new Date() };
  next.questions = mergeQuestions(
    answered.questions.filter((q) => !q.id.startsWith("auto-")),
    next,
  );
  await conn.productKnowledge.set(productId, next);
  return next;
}
