import { z } from "zod";

import { fitToX, xWeightedLength, X_WEIGHTED_LIMIT } from "@/core/action/channels/x-text";
import type { BrandVoice, GrowthPolicy, Opportunity } from "@/db/schema";

import { renderBrandVoice } from "./content-generator";
import { COMMON_RULES, type AgentDeps } from "./shared";

/**
 * ReplyGenerator: an answer to someone's question that happens to come from
 * the person who built a tool for it — never an ad dressed as a reply.
 *
 * The answer and the product mention are asked for separately (`reply`,
 * `bridge`), and whether the bridge is attached is decided here, in code, from
 * the owner's promotional-intensity setting and how clearly the post matched.
 * So "blatant ad replies" (spec §13) are not left to a prompt's good behaviour:
 * at intensity 1 the product is never mentioned, however the model felt.
 */

export const GeneratedReply = z.object({
  reply: z
    .string()
    .describe("相手の問題への答え・役に立つ情報だけの返信。製品名・リンク・宣伝は入れない。相手の言語で、会話として自然に。"),
  bridge: z
    .string()
    .describe("必要な場合だけ使う、自分のプロダクトへの自然な一言（例: 「自分も同じ理由で〜を作っていて…」）。押し付けない。不要なら空文字。"),
  approach: z.string().describe("どう役に立とうとしたか。日本語1文。"),
});

export interface ReplyDraft {
  reply: string;
  bridge: string;
  /** What would be sent: the reply, plus the bridge when the policy allows it. */
  text: string;
  mentionsProduct: boolean;
  approach: string;
}

/**
 * Whether the product may be mentioned at all in this reply. Intensity 1
 * never; 2–3 only when the match is strong and the person is looking for a
 * solution; 4–5 whenever the bridge is not empty.
 */
export function mayMentionProduct(
  intensity: number,
  opportunity: Pick<Opportunity, "relevance" | "intent">,
): boolean {
  if (intensity <= 1) return false;
  if (intensity <= 3) return opportunity.relevance >= 80 && opportunity.intent === "seeking_solution";
  return true;
}

export interface ReplyGeneratorInput {
  opportunity: Pick<Opportunity, "text" | "author" | "source" | "relevance" | "intent" | "reasons">;
  brandVoice: BrandVoice | null;
  policy: Pick<GrowthPolicy, "promotionalIntensity">;
}

export function composeReply(reply: string, bridge: string, allowBridge: boolean, forX: boolean): { text: string; mentionsProduct: boolean } {
  const withBridge = allowBridge && bridge.trim() ? `${reply.trim()}\n\n${bridge.trim()}` : reply.trim();
  const mentionsProduct = withBridge !== reply.trim();
  if (!forX) return { text: withBridge, mentionsProduct };
  // A bridge that pushes the answer over X's limit is the part to drop.
  if (mentionsProduct && xWeightedLength(withBridge) > X_WEIGHTED_LIMIT) return { text: fitToX(reply.trim()), mentionsProduct: false };
  return { text: fitToX(withBridge), mentionsProduct };
}

export async function runReplyGenerator(input: ReplyGeneratorInput, deps: AgentDeps): Promise<ReplyDraft> {
  const intensity = Math.min(5, Math.max(1, Math.round(input.policy.promotionalIntensity)));
  const forX = input.opportunity.source === "x";

  const system =
    deps.system +
    `

あなたはこのプロダクトの作者として、困っている人の投稿に返信を書く。優先順位は次の通り。
1. 相手の問題への回答
2. 役に立つ情報（手順・考え方・選択肢）
3. 自然な会話
4. 必要な場合のみプロダクト紹介（bridge に分けて書く）

- 返信は相手の投稿と同じ言語で書く。
- 露骨な広告にしない。「DMください」「こちらをご覧ください」のような営業文句は書かない。
- 相手の状況を決めつけない。分からないことは質問で返してよい。
${forX ? `- Xの上限（${X_WEIGHTED_LIMIT}。全角は1字2と数える）に収める。` : "- 長すぎない。数段落まで。"}${COMMON_RULES}

# 作者の文体
${renderBrandVoice(input.brandVoice)}`;

  const { value } = await deps.provider.completeStructured({
    kind: "generate",
    schemaName: "reply",
    schema: GeneratedReply,
    system,
    user: [
      `# 相手の投稿（${input.opportunity.source} / ${input.opportunity.author}）`,
      input.opportunity.text,
      "",
      "# この投稿を見込みと判断した理由",
      input.opportunity.reasons.map((r) => `- ${r}`).join("\n"),
    ].join("\n"),
  });

  const allow = mayMentionProduct(intensity, input.opportunity);
  const { text, mentionsProduct } = composeReply(value.reply, value.bridge, allow, forX);
  return { reply: value.reply.trim(), bridge: value.bridge.trim(), text, mentionsProduct, approach: value.approach.trim() };
}
