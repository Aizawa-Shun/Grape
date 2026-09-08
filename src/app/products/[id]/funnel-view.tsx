import type { FunnelResult } from "@/core/data/funnel";

interface Props {
  productId: string;
  funnel: FunnelResult;
  windowDays: number;
}

const STAGE_LABELS: Record<FunnelResult["stages"][number]["stage"], string> = {
  visit: "Visit",
  engage: "Engage",
  activate: "Activate",
  retain: "Retain",
};

function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

const WINDOW_CHOICES = [7, 30, 90];

/**
 * Purely a readout of what core/data/funnel.ts computed — no interpretation
 * here. "Why" a stage is leaking and "what to do about it" are the LLM's job
 * (diagnose.ts / recommend.ts, M3), reasoning over Product Context on top of
 * these numbers. Showing raw numbers first is also how the arithmetic gets
 * sanity-checked against reality before anything is built on top of it.
 */
export function FunnelView({ productId, funnel, windowDays }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {WINDOW_CHOICES.map((days) => (
            <a
              key={days}
              href={`/products/${productId}?windowDays=${days}`}
              className={
                days === windowDays
                  ? "rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700"
              }
            >
              直近{days}日
            </a>
          ))}
        </div>
        <span className="text-xs text-zinc-400">セッション {funnel.totalSessions}</span>
      </div>

      {funnel.isColdStart ? (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          セッション数が {funnel.coldStartMinSessions} 未満です。この期間の遷移率は母数が小さすぎて当てになりません
          — まずは配信経路（Reach）を確保してください。
        </p>
      ) : (
        !funnel.bottleneck && (
          <p className="text-sm text-zinc-400">
            {funnel.hasKeyEvent
              ? "現時点で突出したボトルネックはありません。"
              : "キーイベント未設定のため Activate 以降は計測できません。"}
          </p>
        )
      )}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs text-zinc-400 dark:border-zinc-800">
            <th className="py-1.5 font-normal">段階</th>
            <th className="py-1.5 font-normal">セッション</th>
            <th className="py-1.5 font-normal">直前比</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-zinc-100 dark:border-zinc-900">
            <td className="py-1.5">Visit</td>
            <td className="py-1.5">{funnel.totalSessions}</td>
            <td className="py-1.5 text-zinc-400">—</td>
          </tr>
          {funnel.stages
            .filter((stage) => stage.stage !== "visit")
            .map((stage) => {
              const isBottleneck = funnel.bottleneck?.stage === stage.stage;
              return (
                <tr
                  key={stage.stage}
                  className={
                    isBottleneck
                      ? "border-b border-zinc-100 bg-amber-50 dark:border-zinc-900 dark:bg-amber-950/40"
                      : "border-b border-zinc-100 dark:border-zinc-900"
                  }
                >
                  <td className="py-1.5">
                    {STAGE_LABELS[stage.stage]}
                    {isBottleneck && (
                      <span className="ml-1.5 rounded bg-amber-200 px-1 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-300">
                        ボトルネック
                      </span>
                    )}
                  </td>
                  <td className="py-1.5">{stage.sessions}</td>
                  <td className="py-1.5 text-zinc-500">{formatRate(stage.rateFromPrevious)}</td>
                </tr>
              );
            })}
        </tbody>
      </table>

      {funnel.reachBySource.length > 0 && (
        <div className="flex flex-col gap-1 text-xs text-zinc-500">
          <span className="font-medium text-zinc-600 dark:text-zinc-400">流入元</span>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {funnel.reachBySource.slice(0, 6).map((source) => (
              <li key={source.source}>
                {source.source}: {source.sessions}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
