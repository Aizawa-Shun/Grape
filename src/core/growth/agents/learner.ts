import { z } from "zod";

import { LEARNING_KINDS, type Hypothesis, type HypothesisResult, type LearningKind, type Post } from "@/db/schema";

import { COMMON_RULES, type AgentDeps } from "./shared";

/**
 * Learner (spec §9): a verdict, turned into marketing knowledge about this
 * product — not "what succeeded" but why it came out this way.
 *
 * The verdict and its numbers arrive decided (hypotheses.ts); the model's job
 * is the explanation a founder can act on, read off the actual posts. It
 * cannot change the direction: "works" for supported, "fails" for refuted,
 * "unclear" otherwise, set here in code.
 */

export const LearningOutput = z.object({
  statement: z.string().describe("学びを1文で。次の戦略にそのまま使える形で。例: 「AI開発」より「マーケが苦手」という痛みの方が反応が強い"),
  explanation: z.string().describe("なぜこの結果になったと考えられるか。投稿の中身と数字を結びつけて1〜3文。断定できないことは断定しない。"),
  kind: z.enum(LEARNING_KINDS).describe("pain / audience / message / format / channel / timing / other"),
});
export type LearningOutput = z.infer<typeof LearningOutput>;

export function directionOf(verdict: HypothesisResult["verdict"]): "works" | "fails" | "unclear" {
  return verdict === "supported" ? "works" : verdict === "refuted" ? "fails" : "unclear";
}

const VERDICT_LABEL = { supported: "支持された（効いた）", refuted: "否定された（効かなかった）", inconclusive: "判断できなかった" } as const;

const SUFFIX = `

あなたはこのプロダクトのグロースのアナリストである。仮説の検証結果から、この製品専用のマーケティングの学びを書く。
- 判定（支持・否定・判断不能）はコードが数字で決めている。それと食い違う結論を書かない。
- 「何がうまくいったか」ではなく「なぜこの結果になったか」を書く。投稿の中身（Hook・切り口・製品への触れ方）と数字を結びつける。
- 判断不能の場合は、何が足りないか（件数・数字の種類）と、何を続ければ分かるかを書く。
- 投稿数が少なければ、断定を避けて傾向として書く。${COMMON_RULES}`;

export interface LearnerInput {
  hypothesis: Pick<Hypothesis, "statement" | "subject" | "expected" | "dimension">;
  result: HypothesisResult;
  best: Pick<Post, "text">[];
  worst: Pick<Post, "text">[];
}

const pct = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(1)}%`);

export async function runLearner(input: LearnerInput, deps: AgentDeps): Promise<LearningOutput & { direction: "works" | "fails" | "unclear" }> {
  const r = input.result;
  const { value } = await deps.provider.completeStructured({
    kind: "diagnose",
    schemaName: "learning",
    schema: LearningOutput,
    system: deps.system + SUFFIX,
    user: [
      `# 仮説\n${input.hypothesis.statement}\n切り口: ${input.hypothesis.subject}\n正しければ: ${input.hypothesis.expected}`,
      "",
      `# 判定（コードが数字で決定済み）: ${VERDICT_LABEL[r.verdict]}`,
      r.reason,
      "",
      "# 数字",
      `この仮説の投稿: ${r.posts}本（数字あり${r.measuredPosts}本） 表示${r.impressions ?? "—"} 反応率${pct(r.engagementRate)} 表示→訪問${pct(r.clickRate)} 訪問→登録${pct(r.signupRate)}`,
      `他の投稿（比較対象）: ${r.baseline.posts}本 反応率${pct(r.baseline.engagementRate)} 表示→訪問${pct(r.baseline.clickRate)} 訪問→登録${pct(r.baseline.signupRate)}`,
      "",
      "# この仮説の投稿のうち結果が良かったもの",
      input.best.map((p) => `- ${p.text.replace(/\s+/g, " ").slice(0, 220)}`).join("\n") || "(なし)",
      "",
      "# 結果が悪かったもの",
      input.worst.map((p) => `- ${p.text.replace(/\s+/g, " ").slice(0, 220)}`).join("\n") || "(なし)",
    ].join("\n"),
  });
  return { ...value, kind: value.kind as LearningKind, direction: directionOf(r.verdict) };
}
