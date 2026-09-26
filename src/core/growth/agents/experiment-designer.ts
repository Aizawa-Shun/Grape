import { z } from "zod";

import {
  HYPOTHESIS_DIMENSIONS,
  POST_TYPES,
  type ContentPillar,
  type Hypothesis,
  type HypothesisDimension,
  type Learning,
  type MarketInsight,
  type PositioningStatement,
  type PostType,
  type Segment,
} from "@/db/schema";

import { renderLearnings } from "./strategy-planner";
import { renderPositioning } from "./positioning-analyzer";
import { cleanList, COMMON_RULES, type AgentDeps } from "./shared";

/**
 * ExperimentDesigner (spec §9): the strategy, as claims small enough to test.
 *
 * "AI developers respond to this pain" is a hypothesis; ten posts written for
 * it, next to ten written for a different one, are the experiment. This turns
 * the strategy into two such claims at a time — each about a single variable
 * (which pain, which message, which audience, which format), and comparable
 * with the other — and then into the post ideas that test them.
 *
 * Two at a time because a comparison needs a counterpart, and because five
 * posts a day of feedback on more claims than that would arrive too thin to
 * say anything.
 */

export const HYPOTHESES_PER_ROUND = 2;
export const POSTS_PER_HYPOTHESIS = 5;

export const ExperimentOutput = z.object({
  hypotheses: z.array(
    z.object({
      statement: z.string().describe("検証する仮説を1文で。「〇〇は、△△より反応が強い/登録につながる」の形。"),
      dimension: z.enum(HYPOTHESIS_DIMENSIONS).describe("pain=どの痛みに触れるか / audience=誰に向けるか / message=どの訴求か / format=どの形式か"),
      subject: z.string().describe("いま試している切り口を数語で。例: 「マーケが苦手」の痛み"),
      basis: z.string().describe("なぜそう考えたか。調査のどの発見に基づくか。1〜2文。"),
      expected: z.string().describe("仮説が正しければ、何が見えるか。表示・反応・訪問・登録のどれが高いか。1文。"),
      basisInsights: z.array(z.number().int()).describe("根拠にした調査結果の番号。"),
    }),
  ),
});
export type ExperimentOutput = z.infer<typeof ExperimentOutput>;

export interface HypothesisDraft {
  statement: string;
  dimension: HypothesisDimension;
  subject: string;
  basis: string;
  expected: string;
  basisInsights: string[];
}

const EXPERIMENT_SUFFIX = `

あなたはグロースの実験設計者である。戦略を、投稿で確かめられる仮説に分ける。
- 1つの仮説は、1つの変数だけを問う。例:「『マーケが苦手』という痛みは、『AIで作れる』という訴求より、登録につながる」
- 複数の仮説は、互いに比べられるようにする（同じ変数の、別の選択肢）。
- 5本ほどの投稿で差が見えるほど、はっきり違う切り口にする。
- basis には、調査のどの発見からそう考えたかを書き、basisInsights にその番号を入れる。
- 検証中の仮説や、学びで結論が出た仮説を、根拠なく繰り返さない。効かなかったと分かったことを、もう一度試さない。
- 仮説は作者への説明であり、読者に見せる文ではない。${COMMON_RULES}`;

export interface ExperimentInput {
  segment: Pick<Segment, "name" | "situation" | "problem" | "pain">;
  positioning: PositioningStatement;
  coreMessage: string;
  insights: Pick<MarketInsight, "id" | "kind" | "statement">[];
  learnings: Pick<Learning, "direction" | "statement" | "explanation">[];
  /** Statements already under test, so a new round does not repeat them. */
  testing: string[];
  /** Statements already concluded — supported, refuted or given up on. Never tested again as they are. */
  concluded: string[];
  need: number;
}

/**
 * `seen` starts with everything already tested or under test: a model told
 * not to repeat a refuted claim usually does not, and when it does, re-running
 * the same experiment would only spend a week to learn nothing new.
 */
export function hypothesesFromOutput(
  output: ExperimentOutput,
  insights: ExperimentInput["insights"],
  need: number,
  already: string[] = [],
): HypothesisDraft[] {
  const seen = new Set<string>(already.map((statement) => statement.replace(/\s/g, "")));
  return output.hypotheses
    .filter((h) => {
      const key = h.statement.replace(/\s/g, "");
      if (!h.statement.trim() || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, need)
    .map((h) => ({
      statement: h.statement.trim(),
      dimension: h.dimension,
      subject: h.subject.trim(),
      basis: h.basis.trim(),
      expected: h.expected.trim(),
      basisInsights: [...new Set(h.basisInsights)].map((i) => insights[i]?.id).filter((id): id is string => Boolean(id)),
    }));
}

export async function runExperimentDesigner(input: ExperimentInput, deps: AgentDeps): Promise<HypothesisDraft[]> {
  const { value } = await deps.provider.completeStructured({
    kind: "generate",
    schemaName: "experiment_hypotheses",
    schema: ExperimentOutput,
    system: deps.system + EXPERIMENT_SUFFIX,
    user: [
      `# 狙うセグメント\n${input.segment.name}\n場面: ${input.segment.situation}\n問題: ${input.segment.problem}\n痛み: ${input.segment.pain}`,
      "",
      `# ポジショニング\n${renderPositioning(input.positioning)}`,
      `\n# 中心メッセージ\n${input.coreMessage}`,
      "",
      "# 市場調査の発見（番号で参照する）",
      input.insights.map((i, index) => `[${index}] (${i.kind}) ${i.statement}`).join("\n") || "(なし)",
      input.learnings.length ? `\n${renderLearnings(input.learnings)}` : "",
      input.testing.length ? `\n# いま検証中の仮説（繰り返さない）\n${input.testing.map((t) => `- ${t}`).join("\n")}` : "",
      input.concluded.length ? `\n# 結論が出た仮説（同じものは立てない。学びを踏まえて次の一歩を立てる）\n${input.concluded.map((t) => `- ${t}`).join("\n")}` : "",
      "",
      `作る仮説の数: ${input.need}`,
    ].join("\n"),
  });
  return hypothesesFromOutput(value, input.insights, input.need, [...input.testing, ...input.concluded]);
}

// --- Ideas ------------------------------------------------------------------

export const IdeasOutput = z.object({
  ideas: z.array(
    z.object({
      hypothesisIndex: z.number().int().describe("どの仮説を検証する投稿か。仮説の番号。"),
      pillar: z.string().describe("Content Pillar の名前。入力にあるものから選ぶ。"),
      postType: z.enum(POST_TYPES),
      topic: z.string().describe("投稿のネタを1行で。具体的に。「何について・どんな切り口で」が分かるように。"),
    }),
  ),
});
export type IdeasOutput = z.infer<typeof IdeasOutput>;

export interface IdeaDraft {
  hypothesisId: string;
  pillar: string;
  postType: PostType;
  topic: string;
}

const IDEAS_SUFFIX = `

あなたはこのプロダクトの発信のネタを出す担当である。仮説ごとに、それを検証する投稿のネタを出す。
- 各ネタは、その仮説の切り口（subject）で書く。別の仮説の切り口を混ぜない。
- 同じ仮説のネタは、切り口は同じでも、話題・形式・具体例を変えて重ならないようにする。
- 各仮説について、指定された本数を出す。
- ネタは「何について・どんな角度で」が分かる1行にする。まだ本文は書かない。
- 作者がやっていないこと（実験・計測・顧客の声）を前提にしたネタは出さない。
- pillar は、入力の Content Pillar の名前から選ぶ。${COMMON_RULES}`;

export interface IdeaInput {
  hypotheses: (Pick<Hypothesis, "id" | "statement" | "subject" | "expected"> & { need: number })[];
  pillars: Pick<ContentPillar, "name" | "description" | "postTypes">[];
  coreMessage: string;
  customerPhrases: string[];
  /** Topics already used, so new ideas do not repeat them. */
  existingTopics: string[];
  memory: string;
}

export function ideasFromOutput(output: IdeasOutput, input: IdeaInput): IdeaDraft[] {
  const pillarNames = new Set(input.pillars.map((p) => p.name));
  const fallbackPillar = input.pillars[0]?.name ?? "";
  const used = new Set(input.existingTopics.map((t) => t.replace(/\s/g, "")));
  const counts = new Map<string, number>();
  const ideas: IdeaDraft[] = [];
  for (const idea of output.ideas) {
    const hypothesis = input.hypotheses[idea.hypothesisIndex];
    const key = idea.topic.replace(/\s/g, "");
    if (!hypothesis || !idea.topic.trim() || used.has(key)) continue;
    if ((counts.get(hypothesis.id) ?? 0) >= hypothesis.need) continue;
    counts.set(hypothesis.id, (counts.get(hypothesis.id) ?? 0) + 1);
    used.add(key);
    ideas.push({
      hypothesisId: hypothesis.id,
      pillar: pillarNames.has(idea.pillar) ? idea.pillar : fallbackPillar,
      postType: idea.postType,
      topic: idea.topic.trim(),
    });
  }
  return ideas;
}

export async function runIdeaGenerator(input: IdeaInput, deps: AgentDeps): Promise<IdeaDraft[]> {
  const wanted = input.hypotheses.filter((h) => h.need > 0);
  if (wanted.length === 0) return [];
  const { value } = await deps.provider.completeStructured({
    kind: "generate",
    schemaName: "post_ideas",
    schema: IdeasOutput,
    system: deps.system + IDEAS_SUFFIX,
    user: [
      "# 検証する仮説（番号で参照する）と、出してほしい本数",
      input.hypotheses
        .map((h, i) => (h.need > 0 ? `[${i}] ${h.statement}\n    切り口: ${h.subject}\n    正しければ: ${h.expected}\n    本数: ${h.need}` : null))
        .filter(Boolean)
        .join("\n"),
      "",
      `# 中心メッセージ\n${input.coreMessage}`,
      "",
      "# Content Pillars",
      input.pillars.map((p) => `- ${p.name}: ${p.description}（${p.postTypes.join("・")}）`).join("\n"),
      "",
      "# 見込みユーザーの言い回し",
      cleanList(input.customerPhrases, 12).map((p) => `- ${p}`).join("\n") || "(なし)",
      input.existingTopics.length ? `\n# すでに使ったネタ（重ねない）\n${input.existingTopics.slice(-20).map((t) => `- ${t}`).join("\n")}` : "",
      input.memory ? `\n${input.memory}` : "",
    ].join("\n"),
  });
  return ideasFromOutput(value, input);
}
