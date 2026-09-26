import { z } from "zod";

import type { Hypothesis, MeasurementFunnel } from "@/db/schema";

import { funnelRows } from "../measurement";
import { cleanList, COMMON_RULES, type AgentDeps } from "./shared";

/**
 * Reviewer (spec §8): the week's funnel, and why it looks the way it does.
 *
 * The numbers are counted before this runs (measurement.ts), and so is which
 * stage lost the most people. The model's job is the "why", and the next few
 * things to do about it — in the terms of the stage that is actually losing
 * people, not a generic "post more".
 */

export const ReviewOutput = z.object({
  headline: z.string().describe("今週いちばん大事なことを1文で。"),
  why: z.array(z.string()).describe("数字がこうなっている理由。2〜4件。どの段階で人が減っているかと結びつける。"),
  nextActions: z.array(z.string()).describe("来週やること。2〜3件。一番人が減っている段階に効くものから。"),
});
export type ReviewOutput = z.infer<typeof ReviewOutput>;

const SUFFIX = `

あなたはこのプロダクトのグロース責任者である。1週間のXでの発信の結果を振り返る。
- 数字はコードが数えている。書かれていない数字を作らない。「計測なし」は0ではない。
- 「何が良かったか」より「なぜこうなったか」を書く。一番人が減っている段階に注目する。
- 来週やることは、その段階に効くものにする（表示が少ないなら届け方、訪問が少ないならリンクの理由、登録が少ないならサイト側）。
- 検証中の仮説があれば、その進み具合にも触れる。${COMMON_RULES}`;

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

export function renderFunnel(funnel: MeasurementFunnel): string {
  return funnelRows(funnel)
    .map((row) => `- ${row.label}: ${row.value === null ? `計測なし（${row.missing}）` : row.value}${row.rate ? `（${row.rate.label} ${pct(row.rate.value)}）` : ""}`)
    .join("\n");
}

export async function runReviewer(
  input: { funnel: MeasurementFunnel; hypotheses: Pick<Hypothesis, "statement" | "status">[]; siteFinding: string | null },
  deps: AgentDeps,
): Promise<ReviewOutput> {
  const { value } = await deps.provider.completeStructured({
    kind: "diagnose",
    schemaName: "weekly_review",
    schema: ReviewOutput,
    system: deps.system + SUFFIX,
    user: [
      `# この7日間の投稿 ${input.funnel.posts}本の結果（表示 → 反応 → プロフィール → サイト → 登録 → アクティベーション → 課金）`,
      renderFunnel(input.funnel),
      input.siteFinding ? `\n# サイト全体の診断\n${input.siteFinding}` : "",
      input.hypotheses.length ? `\n# 検証中・結論の出た仮説\n${input.hypotheses.map((h) => `- (${h.status}) ${h.statement}`).join("\n")}` : "",
    ].join("\n"),
  });
  return { headline: value.headline.trim(), why: cleanList(value.why, 4), nextActions: cleanList(value.nextActions, 3) };
}
