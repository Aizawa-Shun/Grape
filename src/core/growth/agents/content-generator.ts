import { z } from "zod";

import { fitToX, X_WEIGHTED_LIMIT } from "@/core/action/channels/x-text";
import type { BrandVoice, GrowthPolicy, PlanSlot, PostType } from "@/db/schema";

import { COMMON_RULES, type AgentDeps } from "./shared";

/**
 * ContentGenerator: the week's plan, written as posts.
 *
 * Each post is asked for as its parts — hook, body, value, CTA — because that
 * is the structure the spec wants a post thought through in, and because the
 * parts are what the performance step later compares ("problem-first hooks
 * worked"). The sendable text is assembled from them in code, measured the
 * way X measures (x-text.ts), with the tracking link appended only when the
 * post actually asks the reader to go somewhere: on X a link costs roughly
 * 13x a bare post, and most educational posts do not need one.
 */

export const GeneratedPosts = z.object({
  posts: z.array(
    z.object({
      slot: z.number().int().describe("計画の番号"),
      hook: z.string().describe("1行目。読む手を止める一文。問題・意外な事実・具体的な数字（入力にあるものだけ）から入る。"),
      body: z.string().describe("本文。価値（読み手が持ち帰れること）を中心に。改行してよい。"),
      cta: z.string().describe("最後の一言。問いかけ・保存・試す・フォローなど。宣伝色は強さの指定に合わせる。無くてもよい（空文字）。"),
      includeLink: z.boolean().describe("プロダクトへのリンクを付けるか。デモ・機能・ローンチ・事例など、見に行く理由がある投稿だけtrue。"),
      rationale: z.string().describe("この投稿で何を狙うか、なぜこの切り口か。日本語1〜2文。"),
    }),
  ),
});

export interface PostDraft {
  slotIndex: number;
  postType: PostType;
  pillar: string;
  plannedFor: string;
  hook: string;
  body: string;
  cta: string;
  /** Without the link; the caller appends the tracking URL once it has a post id. */
  text: string;
  includeLink: boolean;
  rationale: string;
}

/** What a tracking link weighs on X, plus the newline before it. */
export const LINK_RESERVE = 24;

export interface ContentGeneratorInput {
  slots: (PlanSlot & { date: string })[];
  brandVoice: BrandVoice | null;
  userPhrases: string[];
  icpNames: string[];
  /** What worked before, from the latest performance report. */
  learnings: string[];
  policy: Pick<GrowthPolicy, "promotionalIntensity" | "competitorMentions">;
  competitorNames: string[];
}

const POST_TYPE_GUIDE: Record<PostType, string> = {
  educational: "役に立つ知識・やり方を教える",
  problem_awareness: "見込みユーザーが抱える問題に気づかせる・共感する",
  product_demo: "プロダクトが実際に動く様子を短く見せる",
  feature: "1つの機能と、それで何が楽になるか",
  before_after: "使う前と後の違い",
  case_study: "具体的な利用例（入力にある事実だけ）",
  founder_story: "作った理由・作り手の経験",
  build_in_public: "開発の裏側・数字・学び（入力にある事実だけ）",
  question: "フォロワーに問いかけて会話を生む",
  contrarian: "よくある常識への逆張りの意見",
  comparison: "やり方・手段の比較（競合の悪口にしない）",
  tutorial: "手順を追って教える",
  launch: "リリース・公開の告知",
  product_update: "アップデートの告知",
};

export function renderBrandVoice(voice: BrandVoice | null): string {
  if (!voice) return "（登録なし。落ち着いた、押し付けがましくない一人称の文体で書く）";
  return [
    `トーン: ${voice.tone}`,
    `語彙: ${voice.vocabulary}`,
    `文の長さ: ${voice.sentenceLength}`,
    `絵文字: ${voice.emoji}`,
    `技術的な深さ: ${voice.technicalLevel}`,
    `丁寧さ: ${voice.formality}`,
    `ユーモア: ${voice.humor}`,
    ...voice.guidelines.map((g) => `- ${g}`),
    "本人の文章の例:",
    ...voice.samples.slice(0, 3).map((s) => `> ${s.replace(/\n/g, " ")}`),
  ].join("\n");
}

const PROMOTION: Record<number, string> = {
  1: "製品名・リンクはほぼ出さない。価値提供に徹する。",
  2: "製品への言及は控えめに。5本に1本程度。",
  3: "自然な流れがあるときだけ製品に触れる。",
  4: "製品に触れてよい。ただし価値の後に。",
  5: "製品を積極的に紹介してよい。ただし誇張しない。",
};

function competitorRule(policy: ContentGeneratorInput["policy"]): string {
  if (policy.competitorMentions === "never") return "競合の名前は一切出さない。";
  if (policy.competitorMentions === "neutral") return "競合に触れる場合は中立に。批判しない。";
  return "競合と比較してよい。ただし事実に基づき、悪口にしない。";
}

export function assembleText(hook: string, body: string, cta: string, withLink: boolean): string {
  const parts = [hook.trim(), body.trim(), cta.trim()].filter(Boolean);
  return fitToX(parts.join("\n\n"), withLink ? LINK_RESERVE : 0);
}

/** Drops any draft that names a competitor when the policy says never to. */
export function violatesCompetitorPolicy(text: string, policy: ContentGeneratorInput["policy"], names: string[]): boolean {
  if (policy.competitorMentions !== "never") return false;
  const lower = text.toLowerCase();
  return names.some((name) => name.trim().length >= 3 && lower.includes(name.trim().toLowerCase()));
}

export async function runContentGenerator(input: ContentGeneratorInput, deps: AgentDeps): Promise<PostDraft[]> {
  if (input.slots.length === 0) return [];
  const intensity = Math.min(5, Math.max(1, Math.round(input.policy.promotionalIntensity)));

  const system =
    deps.system +
    `

あなたはこのプロダクトの作者の代わりにXへの投稿を書く。構成は Hook → Body → Value → CTA。
- 投稿は「${deps.language}」で書く。Grapeの画面の言語とは関係ない。
- 1投稿はXの上限（${X_WEIGHTED_LIMIT}。日本語などの全角は1字を2と数えるので、日本語なら全体で120字程度まで）に収める。
- ハッシュタグは0〜1個。絵文字は文体の指定に従う。
- 宣伝の強さ: ${PROMOTION[intensity]}
- ${competitorRule(input.policy)}
- 「必ず」「絶対」「No.1」などの誇張、入力に無い実績や数字は書かない。
- 見込みユーザー自身の言い回しがあれば、Hookで使う。${COMMON_RULES}

# 作者の文体
${renderBrandVoice(input.brandVoice)}`;

  const user = [
    "# 書く投稿（計画）",
    input.slots
      .map((slot, index) => `[${index}] ${slot.date} / ${slot.pillar} / ${slot.postType}（${POST_TYPE_GUIDE[slot.postType]}）/ テーマ: ${slot.topic}`)
      .join("\n"),
    "",
    "# 見込みユーザーの言い回し",
    input.userPhrases.slice(0, 12).map((p) => `- ${p}`).join("\n") || "(なし)",
    "",
    `# 想定読者（ICP）: ${input.icpNames.join(" / ") || "(未設定)"}`,
    input.learnings.length ? `\n# これまでに反応が良かったこと\n${input.learnings.map((l) => `- ${l}`).join("\n")}` : "",
  ].join("\n");

  const { value } = await deps.provider.completeStructured({
    kind: "generate",
    schemaName: "x_posts",
    schema: GeneratedPosts,
    system,
    user,
  });

  const drafts: PostDraft[] = [];
  const used = new Set<number>();
  for (const post of value.posts) {
    const slot = input.slots[post.slot];
    if (!slot || used.has(post.slot)) continue;
    const includeLink = post.includeLink && intensity >= 2;
    const text = assembleText(post.hook, post.body, post.cta, includeLink);
    if (!text.trim() || violatesCompetitorPolicy(text, input.policy, input.competitorNames)) continue;
    used.add(post.slot);
    drafts.push({
      slotIndex: post.slot,
      postType: slot.postType,
      pillar: slot.pillar,
      plannedFor: slot.date,
      hook: post.hook.trim(),
      body: post.body.trim(),
      cta: post.cta.trim(),
      text,
      includeLink,
      rationale: post.rationale.trim(),
    });
  }
  return drafts;
}

