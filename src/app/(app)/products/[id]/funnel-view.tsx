import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { cx } from "@/components/ui/cx";
import type { FunnelResult } from "@/core/data/funnel";
import { STAGE_UI } from "@/core/data/stages";

interface Props {
  productId: string;
  funnel: FunnelResult;
  windowDays: number;
}

const WINDOW_CHOICES = [7, 30, 90];

/**
 * A readout of what core/data/funnel.ts computed — no interpretation here.
 * "Why" a stage is leaking is the model's job (diagnose.ts); showing the
 * numbers first is also how the arithmetic gets sanity-checked against
 * reality before anything is built on it.
 *
 * Bars rather than a table, and people lost rather than a percentage: the
 * point a reader has to reach is "this is where they go", and 30.0% in a cell
 * makes them do that work themselves. `sessionsLost` was already computed and
 * simply never shown.
 */
export function FunnelView({ productId, funnel, windowDays }: Props) {
  const measurable = funnel.stages.filter(
    (stage) => funnel.hasKeyEvent || (stage.stage !== "activate" && stage.stage !== "retain"),
  );
  const unmeasurable = funnel.stages.length - measurable.length;
  const widest = Math.max(funnel.totalSessions, 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="集計する期間" className="flex gap-1">
          {WINDOW_CHOICES.map((days) => (
            <Link
              key={days}
              href={`/products/${productId}/funnel?windowDays=${days}`}
              aria-current={days === windowDays ? "page" : undefined}
              className={cx(
                "rounded-md px-2.5 py-1 text-xs",
                days === windowDays
                  ? "bg-accent font-medium text-accent-fg"
                  : "border border-border-strong hover:bg-surface-sunken",
              )}
            >
              {days}日間
            </Link>
          ))}
        </nav>
        <span className="text-xs text-text-muted">
          この期間の訪問 {funnel.totalSessions} 件
        </span>
      </div>

      {funnel.isColdStart ? (
        <Callout title="まだ判断できる人数が来ていません">
          この期間の訪問は {funnel.totalSessions} 件です。
          {funnel.coldStartMinSessions} 件くらい集まるまで、どこで離れているかの割合はあてになりません。
          まずは人に来てもらうところからです。
        </Callout>
      ) : (
        <ol className="flex flex-col gap-1">
          {funnel.reachBySource.length > 0 && (
            <li className="flex flex-col gap-1 pb-2">
              <span className="text-sm font-medium">{STAGE_UI.reach.label}</span>
              <span className="text-xs text-text-muted">
                {funnel.reachBySource
                  .slice(0, 6)
                  .map((source) => `${source.source} ${source.sessions}`)
                  .join("・")}
              </span>
            </li>
          )}

          {measurable.map((stage, index) => {
            const isBottleneck = funnel.bottleneck?.stage === stage.stage;
            const previous = index === 0 ? null : measurable[index - 1];
            const lost = previous ? previous.sessions - stage.sessions : 0;

            return (
              <li key={stage.stage} className="flex flex-col gap-1">
                {previous && lost > 0 && (
                  <p className="border-l border-border pb-2 pl-3 text-xs text-text-muted">
                    ここで {lost} 人が離れています
                  </p>
                )}

                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">{STAGE_UI[stage.stage].label}</span>
                  {isBottleneck && <Badge tone="attention">いま一番の問題</Badge>}
                  <span className="text-xs text-text-muted">{STAGE_UI[stage.stage].help}</span>
                </div>

                <div className="flex items-center gap-2">
                  <div
                    aria-hidden="true"
                    className="h-2.5 flex-1 overflow-hidden rounded-sm bg-surface-sunken"
                  >
                    <div
                      className={cx("h-full rounded-sm", isBottleneck ? "bg-attention" : "bg-accent")}
                      style={{ width: `${Math.max((stage.sessions / widest) * 100, stage.sessions > 0 ? 2 : 0)}%` }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right text-sm tabular-nums">
                    {stage.sessions} 人
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {unmeasurable > 0 && (
        <p className="text-xs text-text-muted">
          「{STAGE_UI.activate.label}」と「{STAGE_UI.retain.label}」は、
          ゴールの操作を決めるまで数えられません。
        </p>
      )}

      {!funnel.isColdStart && !funnel.bottleneck && funnel.hasKeyEvent && (
        <p className="text-sm text-text-muted">
          いまのところ、どこか一箇所で大きく離れている、という状態ではありません。
        </p>
      )}
    </div>
  );
}
