import { z } from "zod";

import { fitToX, xWeightedLength, X_WEIGHTED_LIMIT } from "@/core/action/channels/x-text";
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
      assetNeeded: z
        .string()
        .describe(
          "この投稿を出す前に作者が用意すべきもの（比較画像・デモ動画・実際の数字など）。日本語1文。本文だけで成り立つなら空文字。",
        ),
      rationale: z.string().describe("この投稿で何を狙うか、なぜこの切り口か。日本語1〜2文。"),
    }),
  ),
});

/** Asked of a draft that came back over X's limit, instead of cutting it mid-thought. */
const ShortenedPosts = z.object({
  posts: z.array(
    z.object({
      index: z.number().int(),
      hook: z.string(),
      body: z.string(),
      cta: z.string(),
    }),
  ),
});

/**
 * A target length in the audience's language, stated in characters a model
 * can count. X's weighted limit means a CJK post has half the room, and a
 * link costs 24 of it. Aimed under the limit on purpose: a model told "280"
 * writes 320.
 */
export function charBudget(language: string, withLink: boolean): number {
  const cjk = /^(ja|zh|ko)/i.test(language);
  const room = X_WEIGHTED_LIMIT - (withLink ? LINK_RESERVE : 0);
  return Math.floor((cjk ? room / 2 : room) * 0.85);
}

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
  /** What the author has to prepare before posting — a screenshot, a demo. Empty when nothing. */
  assetNeeded: string;
  rationale: string;
}

/** What a tracking link weighs on X, plus the newline before it. */
export const LINK_RESERVE = 24;

export interface ContentGeneratorInput {
  slots: (PlanSlot & { date: string })[];
  brandVoice: BrandVoice | null;
  userPhrases: string[];
  icpNames: string[];
  /** Agent Memory, already rendered for posts (core/growth/memory.ts). Empty on day one. */
  memory: string;
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
- 長さ: hook・body・cta を合わせて ${charBudget(deps.language, false)} 文字以内（リンクを付ける投稿は ${charBudget(deps.language, true)} 文字以内）。
  超えると投稿できない。1投稿で言うことは1つに絞り、箇条書きは2項目まで。書き終えたら数えて確かめる。
- 作者がまだやっていないこと（実験・比較・計測・事例・顧客の声・画像や動画）を、やった前提で書かない。
  「20個のURLで比べた」「先月◯件処理した」のような事実は入力にある場合だけ書く。
  画像やデモがあると強い投稿なら、本文はそれが無くても成り立つように書き、用意すべきものを assetNeeded に書く。
- 第三者の記事の言い回しは、自分の体験のようには書かない。一般的な現象として書く。
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
    input.memory ? `\n${input.memory}` : "",
  ].join("\n");

  const { value } = await deps.provider.completeStructured({
    kind: "generate",
    schemaName: "x_posts",
    schema: GeneratedPosts,
    system,
    user,
  });

  // Over the limit: ask for a shorter version rather than cutting it off —
  // a post that stops mid-sentence is one nobody would publish.
  const posts = value.posts.map((post) => ({ ...post, includeLink: post.includeLink && intensity >= 2 }));
  const overLimit = posts
    .map((post, index) => ({ post, index }))
    .filter(({ post }) => xWeightedLength([post.hook, post.body, post.cta].filter(Boolean).join("\n\n")) > X_WEIGHTED_LIMIT - (post.includeLink ? LINK_RESERVE : 0));
  if (overLimit.length > 0) {
    const { value: shorter } = await deps.provider.completeStructured({
      kind: "generate",
      effort: "low",
      schemaName: "x_posts_shortened",
      schema: ShortenedPosts,
      system,
      user: [
        "次の投稿はXの上限を超えている。言いたいことを1つに絞って短くする。内容を足さない。",
        ...overLimit.map(
          ({ post, index }) =>
            `[${index}] 上限 ${charBudget(deps.language, post.includeLink)} 文字\nhook: ${post.hook}\nbody: ${post.body}\ncta: ${post.cta}`,
        ),
      ].join("\n\n"),
    });
    for (const fix of shorter.posts) {
      if (posts[fix.index]) posts[fix.index] = { ...posts[fix.index], hook: fix.hook, body: fix.body, cta: fix.cta };
    }
  }

  const drafts: PostDraft[] = [];
  const used = new Set<number>();
  for (const post of posts) {
    const slot = input.slots[post.slot];
    if (!slot || used.has(post.slot)) continue;
    const text = assembleText(post.hook, post.body, post.cta, post.includeLink);
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
      includeLink: post.includeLink,
      assetNeeded: post.assetNeeded.trim(),
      rationale: post.rationale.trim(),
    });
  }
  return drafts;
}
