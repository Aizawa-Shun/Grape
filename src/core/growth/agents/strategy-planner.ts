import { z } from "zod";

import { POST_TYPES, type Competitor, type ContentPillar, type GrowthGoal, type Icp, type MarketInsight, type PlanSlot } from "@/db/schema";

import { normalizeShares, planWeek } from "../mix";
import { cleanList, COMMON_RULES, type AgentDeps } from "./shared";

/**
 * StrategyPlanner: positioning, messaging, the content mix and the week's plan.
 *
 * Written against a goal when there is one ("100 signups in 30 days" wants a
 * different short-term plan than "get anyone at all"), and against the ICPs
 * and gaps research found — the strategy is where those stop being findings
 * and start being choices.
 */

export const StrategyOutput = z.object({
  positioning: z.string().describe("「誰の、どんな問題を、どう解決するか」を1〜2文で。"),
  messaging: z.array(z.string()).describe("主要な訴求メッセージ。3〜5件。1文ずつ。"),
  pillars: z
    .array(
      z.object({
        name: z.string().describe("柱の名前。例: Educational / Problem awareness / Build in public"),
        share: z.number().describe("投稿全体に占める割合（%）。全柱で合計100にする。"),
        description: z.string().describe("この柱で何を発信するか。1文。"),
        postTypes: z.array(z.enum(POST_TYPES)).describe("この柱で使う投稿タイプ。1〜3件。"),
        topicIdeas: z.array(z.string()).describe("この柱の具体的な投稿テーマ案を2〜4件。1行ずつ。"),
      }),
    )
    .describe("Content Pillars を3〜5件。"),
  channels: z
    .array(
      z.object({
        name: z.string().describe("X / Reddit / Product Hunt / SEO / Communities / Direct outreach など"),
        priority: z.number().describe("優先度。1が最優先。"),
        rationale: z.string().describe("なぜこのチャネルか。ICPがそこにいる根拠と合わせて1文。"),
      }),
    )
    .describe("Growth Channels を3〜5件。"),
  shortTerm: z.array(z.string()).describe("今後2週間でやる施策。3〜5件。個人開発者が一人でできる粒度。"),
  midTerm: z.array(z.string()).describe("1〜3か月でやる施策。2〜4件。"),
  rationale: z.string().describe("この戦略にした理由。調査で分かったこと（ICP・未訴求領域・競合）に触れて2〜4文。"),
});
export type StrategyOutput = z.infer<typeof StrategyOutput>;

export interface StrategyDraft {
  positioning: string;
  messaging: string[];
  pillars: ContentPillar[];
  channels: { name: string; priority: number; rationale: string }[];
  shortTerm: string[];
  midTerm: string[];
  weeklyPlan: PlanSlot[];
  rationale: string;
}

const SUFFIX = `

あなたは個人開発者やスタートアップのグロース担当である。調査結果をもとにマーケティング戦略を作る。
- 読み手はマーケティングが苦手な開発者。専門用語を並べず、やることが分かるように書く。
- 主戦場はXでの発信と会話。その他のチャネルは、ICPがいる根拠があるものだけ挙げる。
- 未訴求の領域（gap）があれば、ポジショニングか柱のどれかで必ず取りにいく。
- 製品の宣伝ばかりにしない。教育的な発信・問題提起・開発の裏側を厚くする。${COMMON_RULES}`;

export interface StrategyPlannerInput {
  goal: Pick<GrowthGoal, "metric" | "target" | "deadline"> | null;
  icps: Pick<Icp, "name" | "problem" | "pain" | "channels">[];
  insights: Pick<MarketInsight, "kind" | "statement">[];
  competitors: Pick<Competitor, "name" | "positioning" | "messaging">[];
  /** The latest performance recommendation, when results exist. */
  learning: string | null;
}

export function renderPlannerInput(input: StrategyPlannerInput): string {
  const goal = input.goal
    ? `${input.goal.deadline.toISOString().slice(0, 10)}までに${input.goal.metric === "signups" ? "登録" : "訪問者"}を${input.goal.target}件`
    : "（未設定。まず最初のユーザーを得ることを目標とする）";
  return [
    `# ゴール\n${goal}`,
    "",
    "# ICP",
    input.icps.map((i) => `- ${i.name}: ${i.problem}（痛み: ${i.pain}／いる場所: ${i.channels.join(", ")}）`).join("\n") || "(なし)",
    "",
    "# 市場調査の発見",
    input.insights.map((i) => `- [${i.kind}] ${i.statement}`).join("\n") || "(なし)",
    "",
    "# 競合の訴求",
    input.competitors.map((c) => `- ${c.name}: ${c.positioning} ／ ${c.messaging}`).join("\n") || "(なし)",
    input.learning ? `\n# これまでの結果から分かったこと\n${input.learning}` : "",
  ].join("\n");
}

export function draftFromOutput(value: StrategyOutput): StrategyDraft {
  const pillars = normalizeShares(
    value.pillars.slice(0, 5).map((pillar) => ({
      name: pillar.name.trim(),
      share: pillar.share,
      description: pillar.description,
      postTypes: [...new Set(pillar.postTypes)].slice(0, 3),
    })),
  );
  const topics = Object.fromEntries(value.pillars.map((pillar) => [pillar.name.trim(), cleanList(pillar.topicIdeas, 4)]));

  return {
    positioning: value.positioning,
    messaging: cleanList(value.messaging, 5),
    pillars,
    channels: value.channels
      .slice(0, 5)
      .map((channel) => ({ ...channel, priority: Math.max(1, Math.round(channel.priority)) }))
      .sort((a, b) => a.priority - b.priority),
    shortTerm: cleanList(value.shortTerm, 5),
    midTerm: cleanList(value.midTerm, 4),
    weeklyPlan: planWeek(pillars, topics),
    rationale: value.rationale,
  };
}

export async function runStrategyPlanner(input: StrategyPlannerInput, deps: AgentDeps): Promise<StrategyDraft> {
  const { value } = await deps.provider.completeStructured({
    kind: "generate",
    schemaName: "marketing_strategy",
    schema: StrategyOutput,
    system: deps.system + SUFFIX,
    user: renderPlannerInput(input),
  });
  return draftFromOutput(value);
}
