import { z } from "zod";

import {
  POST_TYPES,
  type Competitor,
  type ContentPillar,
  type GrowthGoal,
  type Learning,
  type MarketInsight,
  type MarketingStrategy,
  type PositioningStatement,
  type Segment,
  type StrategyChange,
  type StrategyChannel,
} from "@/db/schema";

import { normalizeShares } from "../mix";
import { renderPositioning } from "./positioning-analyzer";
import { cleanList, COMMON_RULES, type AgentDeps } from "./shared";

/**
 * StrategyPlanner (spec §6): how to sell it — and what to do first.
 *
 * Two rules keep the strategy from becoming a list of everything one could do.
 * One focus channel: X, the only channel Grape executes, chosen in code — the
 * model explains why and says when each other channel becomes worth starting.
 * And a revision may only change what a result supports: every change names
 * the learning that caused it, and one that names none is dropped.
 */

const PillarSchema = z.object({
  name: z.string().describe("柱の名前。例: 自前運用の現実 / 見せて証明する"),
  share: z.number().describe("投稿全体に占める割合（%）。全柱で合計100にする。"),
  description: z.string().describe("この柱で何を発信するか。1文。"),
  postTypes: z.array(z.enum(POST_TYPES)).describe("この柱で使う投稿タイプ。1〜3件。"),
});

export const StrategyOutput = z.object({
  coreMessage: z.string().describe("すべての発信に通す、たった1つの中心メッセージ。1文。"),
  supportingMessages: z.array(z.string()).describe("中心メッセージを支える訴求。2〜4件。1文ずつ。"),
  pillars: z.array(PillarSchema).describe("Content Pillars を3〜4件。"),
  channels: z
    .array(
      z.object({
        name: z.string().describe("X / Reddit / Product Hunt / SEO / Communities / Direct outreach など"),
        role: z.enum(["focus", "later"]).describe("focus=いま集中する（Xだけ） / later=あとで"),
        rationale: z.string().describe("なぜこの役割か。セグメントがそこにいる根拠と合わせて1文。"),
        startWhen: z.string().describe("laterの場合、始める条件。例: Xで登録が10件出たら。focusなら空文字。"),
      }),
    )
    .describe("Growth Channels。Xをfocusにし、他は2〜3件をlaterにする。"),
  acquisition: z.array(z.string()).describe("Xでユーザーを獲得する具体的な進め方。3〜5件。個人開発者が一人でできる粒度。"),
  conversion: z.array(z.string()).describe("訪れた人を登録に変える施策（サイトの見せ方・導線）。2〜4件。"),
  retentionReferral: z.array(z.string()).describe("継続・紹介を生む案。2〜3件。"),
  rationale: z.string().describe("この戦略にした理由。調査で分かったこと（セグメント・未訴求領域・競合・学び）に触れて2〜4文。"),
});
export type StrategyOutput = z.infer<typeof StrategyOutput>;

export interface StrategyDraft {
  coreMessage: string;
  supportingMessages: string[];
  pillars: ContentPillar[];
  channels: StrategyChannel[];
  acquisition: string[];
  conversion: string[];
  retentionReferral: string[];
  rationale: string;
  changes: StrategyChange[];
}

const IS_X = /^(x|twitter|x\s*\(.*\)|x\s*（.*）)$/i;

/**
 * Exactly one focus, and it is X. Grape executes nothing else yet, so a
 * strategy that made Reddit its focus would be a plan nobody could act on
 * from here; the model's reasoning for the other channels is kept as "later".
 */
export function ensureFocusOnX(channels: StrategyChannel[]): StrategyChannel[] {
  const rest = channels.filter((channel) => !IS_X.test(channel.name.trim()));
  const x = channels.find((channel) => IS_X.test(channel.name.trim()));
  const focus: StrategyChannel = {
    name: "X",
    role: "focus",
    rationale: x?.rationale || "Grapeが実行できるのはXで、見込みユーザーとの最初の接点を作れる。",
    startWhen: "",
  };
  return [focus, ...rest.slice(0, 3).map((channel) => ({ ...channel, role: "later" as const }))];
}

export function pillarsOf(raw: z.infer<typeof PillarSchema>[]): ContentPillar[] {
  return normalizeShares(
    raw.slice(0, 4).map((pillar) => ({
      name: pillar.name.trim(),
      share: pillar.share,
      description: pillar.description,
      postTypes: [...new Set(pillar.postTypes)].slice(0, 3),
    })),
  );
}

export function draftFromOutput(value: StrategyOutput): StrategyDraft {
  return {
    coreMessage: value.coreMessage.trim(),
    supportingMessages: cleanList(value.supportingMessages, 4),
    pillars: pillarsOf(value.pillars),
    channels: ensureFocusOnX(value.channels),
    acquisition: cleanList(value.acquisition, 5),
    conversion: cleanList(value.conversion, 4),
    retentionReferral: cleanList(value.retentionReferral, 3),
    rationale: value.rationale,
    changes: [],
  };
}

const SUFFIX = `

あなたは個人開発者やスタートアップのグロース責任者である。調査結果をもとに、マーケティング戦略を作る。
- 読み手はマーケティングが苦手な開発者。専門用語を並べず、やることが分かるように書く。
- 最初から全部やらない。いま集中するのはXだけ。他のチャネルは「あとで」とし、始める条件を具体的に書く。
- 中心メッセージは1つに絞る。ポジショニングの Because（確認済みの理由）に根ざしたものにする。
- 未訴求の領域（gap）があれば、中心メッセージか柱のどれかで取りにいく。
- 製品の宣伝ばかりにしない。教育的な発信・問題提起・開発の裏側を厚くする。
- 学び（実験の結果）があれば、効いたことを厚く、効かなかったことを薄くする。${COMMON_RULES}`;

export interface StrategyPlannerInput {
  goal: Pick<GrowthGoal, "metric" | "target" | "deadline"> | null;
  segment: Pick<Segment, "name" | "situation" | "problem" | "pain" | "motivation" | "channels">;
  positioning: PositioningStatement;
  insights: Pick<MarketInsight, "kind" | "statement">[];
  competitors: Pick<Competitor, "name" | "positioning" | "messaging">[];
  learnings: Pick<Learning, "direction" | "statement" | "explanation">[];
  /** The site funnel's latest finding, when there is one — what the conversion strategy has to answer. */
  siteFinding: string | null;
}

const METRIC_UNIT = { visitors: "訪問者", signups: "登録", activations: "アクティベーション", paid: "課金" } as const;

export function renderLearnings(learnings: Pick<Learning, "direction" | "statement" | "explanation">[]): string {
  if (learnings.length === 0) return "";
  const label = { works: "効いた", fails: "効かなかった", unclear: "未確定" } as const;
  return ["# 学び（実験の結果。この製品専用のマーケティング知識）", ...learnings.map((l) => `- [${label[l.direction]}] ${l.statement}（理由: ${l.explanation}）`)].join("\n");
}

export function renderPlannerInput(input: StrategyPlannerInput): string {
  const goal = input.goal
    ? `${input.goal.deadline.toISOString().slice(0, 10)}までに${METRIC_UNIT[input.goal.metric]}を${input.goal.target}件`
    : "（未設定。まず最初のユーザーを得ることを目標とする）";
  return [
    `# ゴール\n${goal}`,
    "",
    `# 狙うセグメント\n${input.segment.name}\n場面: ${input.segment.situation}\n問題: ${input.segment.problem}\n痛み: ${input.segment.pain}\n本当にやりたいこと: ${input.segment.motivation}\nいる場所: ${input.segment.channels.join(", ")}`,
    "",
    `# ポジショニング\n${renderPositioning(input.positioning)}`,
    "",
    "# 市場調査の発見",
    input.insights.map((i) => `- [${i.kind}] ${i.statement}`).join("\n") || "(なし)",
    "",
    "# 競合の訴求",
    input.competitors.map((c) => `- ${c.name}: ${c.positioning} ／ ${c.messaging}`).join("\n") || "(なし)",
    input.siteFinding ? `\n# サイトの数字から分かっていること（転換施策が答えるべきこと）\n${input.siteFinding}` : "",
    input.learnings.length ? `\n${renderLearnings(input.learnings)}` : "",
  ].join("\n");
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

// --- Revision ---------------------------------------------------------------

export const StrategyRevisionOutput = z.object({
  coreMessage: z.string().describe("改訂後の中心メッセージ。変えないなら今のまま。"),
  supportingMessages: z.array(z.string()).describe("改訂後の支える訴求。2〜4件。"),
  pillars: z.array(PillarSchema).describe("改訂後のContent Pillars。3〜4件。効いたことを厚く、効かなかったことを薄く。"),
  acquisition: z.array(z.string()).describe("改訂後の獲得の進め方。3〜5件。"),
  changes: z
    .array(
      z.object({
        what: z.string().describe("何を変えたか。1文。"),
        because: z.string().describe("どの学びのどこに基づくか。1文。"),
        learningIndex: z.number().int().describe("根拠にした学びの番号。"),
      }),
    )
    .describe("変えたことの一覧。学びの裏付けが無い変更は書かない。"),
  rationale: z.string().describe("この改訂の要点。2〜3文。"),
});
export type StrategyRevisionOutput = z.infer<typeof StrategyRevisionOutput>;

const REVISION_SUFFIX = `

あなたは個人開発者のグロース責任者である。実験の結果（学び）をもとに、いまの戦略を改訂する。
- 学びの裏付けがあることだけを変える。裏付けの無い思いつきで変えない。
- すべての変更に、根拠にした学びの番号（learningIndex）を付ける。番号の無い変更は採用されない。
- 効いた訴求を厚く、効かなかった訴求を薄くする。ポジショニングとチャネルは変えない。
- 「未確定」の学びは、変更の根拠にしない。もう少し様子を見る材料として扱う。${COMMON_RULES}`;

export interface StrategyRevisionInput {
  current: Pick<MarketingStrategy, "coreMessage" | "supportingMessages" | "pillars" | "acquisition">;
  positioning: PositioningStatement;
  /** New learnings first: the ones this revision answers. Index = position. */
  learnings: Pick<Learning, "direction" | "statement" | "explanation">[];
}

/**
 * The revision, or null when nothing in it is backed by a learning. Changes
 * that name no real learning — or only an unclear one — are dropped, and a
 * revision left with none has changed nothing worth a new version.
 */
export function revisionFromOutput(value: StrategyRevisionOutput, learnings: StrategyRevisionInput["learnings"]): StrategyDraft | null {
  const changes: StrategyChange[] = value.changes
    .filter((change) => {
      const learning = learnings[change.learningIndex];
      return learning && learning.direction !== "unclear" && change.what.trim() && change.because.trim();
    })
    .map((change) => ({ what: change.what.trim(), because: change.because.trim() }));
  if (changes.length === 0) return null;
  return {
    coreMessage: value.coreMessage.trim(),
    supportingMessages: cleanList(value.supportingMessages, 4),
    pillars: pillarsOf(value.pillars),
    channels: [],
    acquisition: cleanList(value.acquisition, 5),
    conversion: [],
    retentionReferral: [],
    rationale: value.rationale,
    changes,
  };
}

export async function runStrategyRevision(input: StrategyRevisionInput, deps: AgentDeps): Promise<StrategyDraft | null> {
  const { value } = await deps.provider.completeStructured({
    kind: "diagnose",
    schemaName: "strategy_revision",
    schema: StrategyRevisionOutput,
    system: deps.system + REVISION_SUFFIX,
    user: [
      "# いまの戦略",
      `中心メッセージ: ${input.current.coreMessage}`,
      `支える訴求: ${input.current.supportingMessages.join(" / ")}`,
      `柱: ${input.current.pillars.map((p) => `${p.name} ${p.share}%（${p.description}）`).join(" / ")}`,
      `獲得: ${input.current.acquisition.join(" / ")}`,
      "",
      `# ポジショニング\n${renderPositioning(input.positioning)}`,
      "",
      "# 学び（番号で参照する）",
      input.learnings
        .map((l, i) => `[${i}] [${l.direction === "works" ? "効いた" : l.direction === "fails" ? "効かなかった" : "未確定"}] ${l.statement}（理由: ${l.explanation}）`)
        .join("\n"),
    ].join("\n"),
  });
  return revisionFromOutput(value, input.learnings);
}
