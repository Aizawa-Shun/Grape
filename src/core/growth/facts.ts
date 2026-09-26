import type { Evidence, Fact, KnowledgeTopic, OpenQuestion, ProductKnowledge } from "@/db/schema";

/**
 * Known, assumed, or not known — decided in code.
 *
 * The distinction is the point of the Product Knowledge: Grape must never
 * talk about a product as though it knew something it only guessed. A model
 * that is asked to sort its own claims into "the site says this" and "I infer
 * this" will sort them generously, so the sorting is not left to it: a claim
 * is `known` only if the sentence it quotes is really on one of the pages
 * that were read. A quote that cannot be found downgrades the claim to an
 * assumption, whatever the model said.
 *
 * Pure — no database, no model — so both the analyzer and the editor use it.
 */

export const TOPIC_LABELS: Record<KnowledgeTopic, string> = {
  what: "何をするものか",
  targetUsers: "誰のためのものか",
  problems: "解決する問題",
  benefits: "得られる価値",
  features: "主な機能",
  differentiators: "他との違い",
  useCases: "使われ方",
  pricing: "料金",
  proof: "実績・証拠",
};

/** The list-valued topics, in the order they are shown. `what` is a single fact. */
export const LIST_TOPICS = [
  "targetUsers",
  "problems",
  "benefits",
  "features",
  "differentiators",
  "useCases",
  "pricing",
  "proof",
] as const satisfies readonly KnowledgeTopic[];
export type ListTopic = (typeof LIST_TOPICS)[number];

export interface SourcePage {
  url: string;
  title: string | null;
  text: string;
  meta?: Record<string, string>;
}

/** NFKC, lower case, one space between words: what "the same sentence" means. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A quote as a model tends to write it: wrapped in quote marks, trailing an ellipsis. */
function cleanQuote(quote: string): string {
  return normalizeText(quote)
    .replace(/^[「『"'“‘]+/, "")
    .replace(/[」』"'”’]+$/, "")
    .replace(/(…|\.{3})+$/, "")
    .replace(/^(…|\.{3})+/, "")
    .trim();
}

const MIN_QUOTE_CHARS = 6;

/**
 * The page a quote is really on, or null. Prefers the page the model named,
 * but a quote found on another page is credited to that page — the evidence
 * shown to a person must point where the sentence actually is.
 */
export function findEvidence(quote: string, pages: SourcePage[], preferredUrl?: string): Evidence | null {
  const needle = cleanQuote(quote);
  if (needle.length < MIN_QUOTE_CHARS) return null;
  const ordered = [...pages].sort((a, b) => Number(b.url === preferredUrl) - Number(a.url === preferredUrl));
  for (const page of ordered) {
    const haystack = normalizeText([page.title ?? "", ...Object.values(page.meta ?? {}), page.text].join(" "));
    if (haystack.includes(needle)) return { url: page.url, quote: quote.trim() };
  }
  return null;
}

export interface RawFact {
  text: string;
  status: "known" | "assumption";
  quote: string;
  url: string;
}

export function verifyFact(raw: RawFact, pages: SourcePage[]): Fact | null {
  const text = raw.text.trim();
  if (!text) return null;
  if (raw.status === "known") {
    const evidence = findEvidence(raw.quote, pages, raw.url);
    if (evidence) return { text, status: "known", basis: "site", evidence: [evidence] };
  }
  return { text, status: "assumption", basis: "inference", evidence: [] };
}

export function verifyFacts(raws: RawFact[], pages: SourcePage[]): Fact[] {
  const seen = new Set<string>();
  const facts: Fact[] = [];
  for (const raw of raws) {
    const fact = verifyFact(raw, pages);
    // Spaces are not a difference between two Japanese sentences.
    const key = fact ? normalizeText(fact.text).replace(/\s/g, "") : "";
    if (!fact || seen.has(key)) continue;
    seen.add(key);
    facts.push(fact);
  }
  return facts;
}

/**
 * What a person's edit is allowed to claim. Their own words are known (they
 * are the authority on their product); a site claim needs its evidence; and
 * anything else is an assumption. Applied to whatever the editor sends, so a
 * stored fact can never say more than its basis supports.
 */
export function normalizeFact(fact: Fact): Fact {
  const text = fact.text.trim();
  if (fact.basis === "owner") return { text, status: "known", basis: "owner", evidence: fact.evidence };
  if (fact.basis === "site" && fact.evidence.length > 0) return { text, status: "known", basis: "site", evidence: fact.evidence };
  return { text, status: "assumption", basis: "inference", evidence: [] };
}

export function ownerFact(text: string): Fact {
  return { text: text.trim(), status: "known", basis: "owner", evidence: [] };
}

export function factsOf(knowledge: ProductKnowledge, topic: KnowledgeTopic): Fact[] {
  if (topic === "what") return knowledge.what ? [knowledge.what] : [];
  return knowledge[topic];
}

export interface KnowledgeTally {
  known: number;
  assumption: number;
  questions: number;
}

export function tally(knowledge: ProductKnowledge): KnowledgeTally {
  const all = [...(knowledge.what ? [knowledge.what] : []), ...LIST_TOPICS.flatMap((topic) => knowledge[topic])];
  return {
    known: all.filter((fact) => fact.status === "known").length,
    assumption: all.filter((fact) => fact.status === "assumption").length,
    questions: knowledge.questions.length,
  };
}

const STRUCTURAL: Record<KnowledgeTopic, { question: string; whyItMatters: string }> = {
  what: {
    question: "一言でいうと、これは何のサービスですか？",
    whyItMatters: "すべての投稿の出発点になります。",
  },
  targetUsers: {
    question: "一番使ってほしいのは、どんな人ですか？（仕事と、困っている場面まで）",
    whyItMatters: "誰に向けて話すかで、投稿の中身も、探す場所も変わります。",
  },
  problems: {
    question: "お客さんのどんな困りごとを解決しますか？",
    whyItMatters: "投稿は、製品の説明ではなく、相手の困りごとから始めるためです。",
  },
  benefits: {
    question: "使った人は、何が良くなりますか？",
    whyItMatters: "「便利」ではなく、具体的な変化で伝えるためです。",
  },
  features: {
    question: "主な機能を教えてください。",
    whyItMatters: "無い機能を、あるかのように書かないためです。",
  },
  differentiators: {
    question: "似たサービスや、今使われている手段と比べて、何が一番違いますか？",
    whyItMatters: "選ばれる理由を、根拠のある言葉で言うためです。",
  },
  useCases: {
    question: "実際に、どんな場面で使われていますか？",
    whyItMatters: "具体的な場面は、投稿のネタになります。",
  },
  pricing: {
    question: "料金や、無料で使える範囲を教えてください。",
    whyItMatters: "「無料で試せる」などを、言ってよいかを判断するためです。",
  },
  proof: {
    question: "使っている人の数、お客さんの声、実績など、数字や名前で言えることはありますか？",
    whyItMatters: "根拠のない自慢を避け、本当に言えることだけで信頼を作るためです。",
  },
};

/** Questions that follow from a topic having nothing known in it — the gaps a checklist finds, not a model. */
export function structuralQuestions(knowledge: ProductKnowledge): OpenQuestion[] {
  // Never asked: how it works, and use cases — nice to have, and a model can ask if they matter.
  const asked: KnowledgeTopic[] = ["what", "targetUsers", "problems", "differentiators", "pricing", "proof"];
  return asked
    .filter((topic) => !factsOf(knowledge, topic).some((fact) => fact.status === "known"))
    .map((topic) => ({
      id: `auto-${topic}`,
      topic,
      question: STRUCTURAL[topic].question,
      whyItMatters: STRUCTURAL[topic].whyItMatters,
      guess: factsOf(knowledge, topic).find((fact) => fact.status === "assumption")?.text ?? null,
    }));
}

const MAX_QUESTIONS = 7;

/** The model's own questions, then the checklist's for whatever topics they did not cover. */
export function mergeQuestions(fromModel: OpenQuestion[], knowledge: ProductKnowledge): OpenQuestion[] {
  const merged: OpenQuestion[] = [];
  const perTopic = new Map<KnowledgeTopic, number>();
  const add = (question: OpenQuestion) => {
    const count = perTopic.get(question.topic) ?? 0;
    if (count >= 2 || merged.length >= MAX_QUESTIONS) return;
    perTopic.set(question.topic, count + 1);
    merged.push(question);
  };
  for (const question of fromModel) if (question.question.trim()) add(question);
  for (const question of structuralQuestions(knowledge)) {
    if (!perTopic.has(question.topic)) add(question);
  }
  return merged;
}

/** A question answered: the answer becomes a fact from the owner, and the question closes. */
export function applyAnswer(knowledge: ProductKnowledge, questionId: string, answer: string): ProductKnowledge {
  const question = knowledge.questions.find((q) => q.id === questionId);
  const text = answer.trim();
  if (!question || !text) return knowledge;
  const fact = ownerFact(text);
  const next: ProductKnowledge = { ...knowledge, questions: knowledge.questions.filter((q) => q.id !== questionId) };
  if (question.topic === "what") next.what = fact;
  else next[question.topic] = [...knowledge[question.topic], fact];
  return next;
}
