import { z } from "zod";

import type { Competitor, Fact, MarketInsight, PositioningBecause, PositioningStatement, Segment } from "@/db/schema";

import { cleanList, COMMON_RULES, type AgentDeps } from "./shared";

/**
 * PositioningAnalyzer (spec §5): For [target] who [problem], our product is
 * [solution]. Unlike [alternatives], because [differentiators].
 *
 * The "because" is where positioning usually turns into a boast, so it cannot
 * be written freely: the model picks from the numbered differentiators and
 * proof in the Product Knowledge, and the status of each pick — known or
 * assumed — is read back from the fact, not from the model. A positioning
 * resting on assumptions says so, and the owner sees which.
 */

export const PositioningOutput = z.object({
  oneLiner: z.string().describe("このポジショニングを1文で。60字以内。"),
  forWhom: z.string().describe("For: 誰のために。セグメントの役割と場面。"),
  problem: z.string().describe("Who: その人が抱えている問題。"),
  product: z.string().describe("Our product: 何であり、どう解決するか（カテゴリと解決策）。"),
  alternatives: z.array(z.string()).describe("Unlike: 比べる相手。競合名、または今の凌ぎ方（自前運用・表計算など）。1〜3件。"),
  becauseFacts: z.array(z.number().int()).describe("Because: 選ばれる理由。入力の番号付き事実から、1〜3件の番号を選ぶ。"),
});
export type PositioningOutput = z.infer<typeof PositioningOutput>;

const SUFFIX = `

あなたはSaaSのポジショニングを決める担当である。狙うセグメントに対して、このプロダクトを何として位置づけるかを決める。
- 「For / Who / Our product / Unlike / Because」の構造で書く。
- Because は、入力の番号付き事実（プロダクトの差別化と実績）から選ぶ。自由に書かない。[確認済み] を優先する。
  選べる事実が [仮説] しかないなら、それを選んでよいが、それは仮説として扱われる。
- Unlike は、競合の名前か、セグメントの今の凌ぎ方から選ぶ。
- 誇張しない。数字や固有名詞で言えることを軸にする。${COMMON_RULES}`;

export interface PositioningInput {
  segment: Pick<Segment, "id" | "name" | "role" | "situation" | "problem" | "pain" | "motivation" | "currentSolutions">;
  differentiators: Fact[];
  proof: Fact[];
  competitors: Pick<Competitor, "name" | "positioning">[];
  gaps: Pick<MarketInsight, "statement">[];
}

/** The pool the model picks its "because" from: differentiators first, then proof. */
export function becausePool(input: Pick<PositioningInput, "differentiators" | "proof">): Fact[] {
  return [...input.differentiators, ...input.proof];
}

export function positioningFromOutput(output: PositioningOutput, input: PositioningInput): PositioningStatement {
  const pool = becausePool(input);
  const picked = [...new Set(output.becauseFacts)].map((index) => pool[index]).filter((fact): fact is Fact => Boolean(fact));
  // Nothing valid picked: fall back to the strongest thing that is known, rather than to nothing.
  const chosen = picked.length > 0 ? picked : pool.filter((fact) => fact.status === "known").slice(0, 1);
  const because: PositioningBecause[] = chosen.slice(0, 3).map((fact) => ({ text: fact.text, status: fact.status }));
  return {
    segmentId: input.segment.id,
    segmentName: input.segment.name,
    oneLiner: output.oneLiner.trim(),
    forWhom: output.forWhom.trim(),
    problem: output.problem.trim(),
    product: output.product.trim(),
    alternatives: cleanList(output.alternatives, 3),
    because,
  };
}

export async function runPositioningAnalyzer(input: PositioningInput, deps: AgentDeps): Promise<PositioningStatement> {
  const pool = becausePool(input);
  const { segment } = input;
  const { value } = await deps.provider.completeStructured({
    kind: "generate",
    schemaName: "positioning",
    schema: PositioningOutput,
    system: deps.system + SUFFIX,
    user: [
      "# 狙うセグメント",
      `${segment.name}（${segment.role}）`,
      `場面: ${segment.situation}`,
      `問題: ${segment.problem}`,
      `痛み: ${segment.pain}`,
      `本当にやりたいこと: ${segment.motivation}`,
      `今の凌ぎ方: ${segment.currentSolutions.join(" / ")}`,
      "",
      "# 選べる「選ばれる理由」（番号で選ぶ）",
      pool.map((fact, index) => `[${index}] [${fact.status === "known" ? "確認済み" : "仮説"}] ${fact.text}`).join("\n") || "(なし)",
      "",
      "# 競合",
      input.competitors.map((c) => `- ${c.name}: ${c.positioning}`).join("\n") || "(なし)",
      "",
      "# まだ誰も訴求していない領域",
      input.gaps.map((g) => `- ${g.statement}`).join("\n") || "(なし)",
    ].join("\n"),
  });
  return positioningFromOutput(value, input);
}

/** The positioning as the layout the spec gives it, for any prompt that builds on it. */
export function renderPositioning(p: PositioningStatement): string {
  return [
    `For（誰のために）: ${p.forWhom}`,
    `Who（その人の問題）: ${p.problem}`,
    `Our product（何であり、どう解決するか）: ${p.product}`,
    `Unlike（比べる相手）: ${p.alternatives.join("、") || "（未定）"}`,
    `Because（選ばれる理由）: ${p.because.map((b) => `${b.text}（${b.status === "known" ? "確認済み" : "仮説"}）`).join("／") || "（確認済みの差別化がまだ無い）"}`,
  ].join("\n");
}
