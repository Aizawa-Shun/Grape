import { z } from "zod";

import type { TypeStats } from "@/db/schema";

import type { PostPerformance } from "../performance";
import { cleanList, COMMON_RULES, type AgentDeps } from "./shared";

/**
 * PerformanceAnalyzer: why the posts that worked, worked.
 *
 * The ranking arrives already computed (performance.ts). The model's job is
 * the sentence a founder can act on — "problem-first hooks outperformed
 * product mentions" — read off the actual posts and numbers in front of it.
 * It cannot re-rank anything; there is no field for that.
 */

export const PerformanceNarrative = z.object({
  worked: z.array(z.string()).describe("うまくいった理由を2〜4件。投稿の具体的な特徴（Hookの型、テーマ、製品への言及の位置など）と数字を結びつけて。"),
  failed: z.array(z.string()).describe("うまくいかなかった理由を1〜3件。"),
  recommendation: z.string().describe("来週いちばんやるべきことを1〜2文で。例: 「機能紹介より具体的なHow-to投稿を増やす」"),
  nextActions: z.array(z.string()).describe("具体的な次の施策を2〜4件。"),
});
export type PerformanceNarrative = z.infer<typeof PerformanceNarrative>;

function pct(value: number | null): string {
  return value === null ? "計測なし" : `${(value * 100).toFixed(1)}%`;
}

export function renderStats(stats: TypeStats[]): string {
  return stats
    .map(
      (s) =>
        `- ${s.postType}: ${s.posts}本 / 表示${s.impressions} / 反応率${pct(s.engagementRate)} / サイト訪問${s.visits}（${pct(s.clickRate)}） / 登録${s.signups} / 総合${s.score}`,
    )
    .join("\n");
}

function renderPost(p: PostPerformance): string {
  const m = p.post.metrics;
  return `- [${p.post.postType}] 表示${m?.impressions ?? "?"} いいね${m?.likes ?? "?"} 訪問${p.attribution.visits} 登録${p.attribution.signups}\n  ${p.post.text.replace(/\s+/g, " ").slice(0, 200)}`;
}

export async function runPerformanceAnalyzer(
  input: { stats: TypeStats[]; performances: PostPerformance[] },
  deps: AgentDeps,
): Promise<PerformanceNarrative> {
  const ranked = [...input.performances].sort(
    (a, b) =>
      b.attribution.signups - a.attribution.signups ||
      b.attribution.visits - a.attribution.visits ||
      (b.post.metrics?.impressions ?? 0) - (a.post.metrics?.impressions ?? 0),
  );

  const { value } = await deps.provider.completeStructured({
    kind: "diagnose",
    schemaName: "performance_analysis",
    schema: PerformanceNarrative,
    system:
      deps.system +
      `

あなたはこのプロダクトのグロース担当のアナリストである。公開した投稿の結果を読み、
なぜうまくいった/いかなかったかを説明し、次にやることを決める。
- 順位はすでにコードが計算している（総合スコア）。それと食い違う結論を書かない。
- CTRだけで判断しない。反応・クリック・登録を合わせて見る。
- 投稿数が少ない場合は、断定を避けて「傾向」として書く。${COMMON_RULES}`,
    user: [
      "# 投稿タイプ別の結果（コードで集計済み。総合スコアの高い順）",
      renderStats(input.stats),
      "",
      "# 結果の良かった投稿",
      ranked.slice(0, 4).map(renderPost).join("\n"),
      "",
      "# 結果の悪かった投稿",
      ranked.slice(-3).reverse().map(renderPost).join("\n"),
    ].join("\n"),
  });

  return {
    worked: cleanList(value.worked, 4),
    failed: cleanList(value.failed, 3),
    recommendation: value.recommendation.trim(),
    nextActions: cleanList(value.nextActions, 4),
  };
}
