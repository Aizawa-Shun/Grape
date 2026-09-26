import { z } from "zod";

import type { SaasAnalysis } from "@/core/context/analysis";
import { renderContextSnapshot } from "@/core/context/snapshot";
import type { LLMProvider } from "@/core/llm/types";
import { KNOWLEDGE_TOPICS, type Fact, type KnowledgeTopic, type OpenQuestion, type Product, type ProductContext, type ProductKnowledge } from "@/db/schema";

import { mergeQuestions, ownerFact, verifyFacts, type SourcePage } from "../facts";
import { COMMON_RULES } from "./shared";

/**
 * ProductAnalyzer (spec §3): the Product Knowledge, from what the site says.
 *
 * Every claim comes back with a status and, if it says "known", the sentence
 * it rests on. Code then checks that sentence is on the page (facts.ts) —
 * so what ends up marked known is known, and what the model only inferred is
 * kept, used, and shown as an assumption. What the site does not settle is
 * not guessed into a fact: it becomes a question for the owner.
 *
 * It reads the pages themselves rather than the registration analysis,
 * because a quote can only be verified against source text.
 */

const FactItem = z.object({
  text: z.string().describe("事実または推測を1文で。である調。"),
  status: z.enum(["known", "assumption"]).describe("known=サイトに書いてある / assumption=書いてはいないが妥当に言える"),
  quote: z.string().describe("knownのとき、根拠にしたページ本文の一文をそのままコピーする。要約・言い換えは禁止。assumptionなら空文字。"),
  url: z.string().describe("quote があるページのURL。無ければ空文字。"),
});

export const ProductAnalyzerOutput = z.object({
  what: FactItem.describe("何をするプロダクトか"),
  targetUsers: z.array(FactItem).describe("使う人。役割と状況まで。2〜4件"),
  problems: z.array(FactItem).describe("解決する問題。2〜4件"),
  benefits: z.array(FactItem).describe("使うと得られる価値。2〜4件"),
  features: z.array(FactItem).describe("主な機能。サイトで確認できるものだけ。3〜8件"),
  differentiators: z.array(FactItem).describe("他の手段と比べた違い。具体的なものを優先。2〜5件"),
  useCases: z.array(FactItem).describe("使われ方。2〜5件"),
  pricing: z.array(FactItem).describe("料金。プランごとに1件。サイトに無ければ空配列"),
  proof: z.array(FactItem).describe("実績・証拠。利用者数・稼働率・導入企業・お客様の声など。無ければ空配列。作らない"),
  questions: z
    .array(
      z.object({
        topic: z.enum(KNOWLEDGE_TOPICS),
        question: z.string().describe("オーナー本人に聞く一文。専門用語を使わず、日常の言葉で。"),
        whyItMatters: z.string().describe("それが分かると、マーケティングの何が良くなるか。1文。"),
        guess: z.string().describe("現時点の推測。無ければ空文字。"),
      }),
    )
    .describe("マーケティングに要るのに、サイトからは判断できないこと。最大5件"),
});
export type ProductAnalyzerOutput = z.infer<typeof ProductAnalyzerOutput>;

const SYSTEM_SUFFIX = `

あなたはSaaSのプロダクトマーケターである。上のProduct Contextと、入力の公開ページの本文をもとに、
このプロダクトの「マーケティングの前提」を、事実と推測に分けて整理する。

最重要: 事実（known）と推測（assumption）を混ぜない。
- known: サイトの文章に書いてあること。quote にページ本文の一文をそのままコピーし、url にそのページのURLを入れる。
  要約・翻訳・言い換えは quote に入れない。コードが quote の実在を検証し、ページに無ければ推測に格下げされる。
- assumption: 書いてはいないが、ページの手がかりから妥当に言えること。quote は空文字。
- 分からないことは、事実に混ぜず questions に書く。
- Product Contextが作者の確認済みなら、それを最優先する。ページと食い違う場合もContextに従う。

書き方:
- 誇張（「最高」「業界No.1」）は、そう書いてあっても known にしない。数字や固有名詞で言えることを優先する。
- differentiators は「高速」のような形容詞で終わらせず、何がどう違うかまで書く。
- proof には、ページに書かれた数字・実績・導入名・お客様の声だけを入れる。無ければ空配列でよい。
- questions は、答えがマーケティングの判断を変えるものに絞る（誰に向けるか、何を言ってよいか）。${COMMON_RULES}`;

const MAX_PAGES = 6;
const MAX_PAGE_CHARS = 3_500;

export function renderPages(pages: SourcePage[]): string {
  return pages
    .filter((page) => page.text.trim())
    .slice(0, MAX_PAGES)
    .map((page) => `## ${page.url}\ntitle: ${page.title ?? "(なし)"}\n${page.text.slice(0, MAX_PAGE_CHARS)}`)
    .join("\n\n---\n\n");
}

export interface ProductKnowledgeDraft {
  what: Fact | null;
  targetUsers: Fact[];
  problems: Fact[];
  benefits: Fact[];
  features: Fact[];
  differentiators: Fact[];
  useCases: Fact[];
  pricing: Fact[];
  proof: Fact[];
  questions: OpenQuestion[];
}

export interface ProductAnalyzerInput {
  product: Product;
  context: ProductContext;
  pages: SourcePage[];
}

/** Model output → verified facts and merged questions. Pure, so the tests can feed it a model's answer. */
export function knowledgeFromOutput(output: ProductAnalyzerOutput, pages: SourcePage[]): ProductKnowledgeDraft {
  const [what] = verifyFacts([output.what], pages);
  const draft: ProductKnowledgeDraft = {
    what: what ?? null,
    targetUsers: verifyFacts(output.targetUsers, pages),
    problems: verifyFacts(output.problems, pages),
    benefits: verifyFacts(output.benefits, pages),
    features: verifyFacts(output.features, pages),
    differentiators: verifyFacts(output.differentiators, pages),
    useCases: verifyFacts(output.useCases, pages),
    pricing: verifyFacts(output.pricing, pages),
    proof: verifyFacts(output.proof, pages),
    questions: [],
  };
  const asked: OpenQuestion[] = output.questions.slice(0, 5).map((q) => ({
    id: crypto.randomUUID(),
    topic: q.topic as KnowledgeTopic,
    question: q.question.trim(),
    whyItMatters: q.whyItMatters.trim(),
    guess: q.guess.trim() || null,
  }));
  draft.questions = mergeQuestions(asked, { ...draft, id: "", productId: "", brandVoice: null, contextVersion: 0, updatedAt: new Date() });
  return draft;
}

export async function runProductAnalyzer(input: ProductAnalyzerInput, provider: LLMProvider): Promise<ProductKnowledgeDraft> {
  const { value } = await provider.completeStructured({
    kind: "extract",
    schemaName: "product_knowledge",
    schema: ProductAnalyzerOutput,
    system: renderContextSnapshot(input.product, input.context) + SYSTEM_SUFFIX,
    user: `# 公開ページの本文\n\n${renderPages(input.pages)}`,
  });
  return knowledgeFromOutput(value, input.pages);
}

/**
 * Without a model: only what a person has confirmed can be called known, so
 * the four confirmed answers become the owner's facts; an unconfirmed
 * rule-based reading is an assumption, and the analysis's lists — which carry
 * one status for the whole list, not per item — are assumptions too. Thin,
 * but every fact in it is honest about what stands behind it.
 */
export function knowledgeWithoutModel(context: ProductContext, analysis: SaasAnalysis | null): ProductKnowledgeDraft {
  const own = context.editedByHuman;
  const fact = (text: string): Fact | null => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    return own ? ownerFact(trimmed) : { text: trimmed, status: "assumption", basis: "inference", evidence: [] };
  };
  const list = (...items: (Fact | null)[]) => items.filter((item): item is Fact => item !== null);
  const assumed = (items: string[]): Fact[] =>
    items.map((text) => ({ text: text.trim(), status: "assumption" as const, basis: "inference" as const, evidence: [] })).filter((f) => f.text);

  const draft: ProductKnowledgeDraft = {
    what: fact(context.what),
    targetUsers: list(fact(context.who)),
    problems: list(fact(context.why)),
    benefits: [],
    features: [...list(fact(context.how)), ...assumed(analysis?.service.features.items ?? [])],
    differentiators: assumed(analysis?.insights.differentiation ?? []),
    useCases: [],
    pricing: analysis && analysis.business.pricing.status !== "unknown" ? assumed([analysis.business.pricing.value]) : [],
    proof: [],
    questions: [],
  };
  draft.questions = mergeQuestions([], { ...draft, id: "", productId: "", brandVoice: null, contextVersion: 0, updatedAt: new Date() } as ProductKnowledge);
  return draft;
}
