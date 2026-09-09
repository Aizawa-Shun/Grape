import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/empty-state";
import type { FunnelResult } from "@/core/data/funnel";
import { STAGE_UI } from "@/core/data/stages";
import type { FunnelStage } from "@/db/schema";

interface Props {
  productId: string;
  funnel: FunnelResult;
  windowDays: number;
}

const WINDOW_CHOICES = [7, 30, 90];
const ORDER: FunnelStage[] = ["reach", "visit", "engage", "activate", "retain"];

/**
 * A readout of what core/data/funnel.ts computed — no interpretation here.
 * "Why" a stage is leaking is the model's job (diagnose.ts); showing the
 * numbers first is also how the arithmetic gets sanity-checked against
 * reality before anything is built on it.
 *
 * Bars rather than a table, and people lost rather than a percentage: the
 * point a reader has to reach is "this is where they go", and 30.0% in a cell
 * makes them do that work themselves.
 */
export function FunnelView({ productId, funnel, windowDays }: Props) {
  const measurable = funnel.stages.filter(
    (stage) => funnel.hasKeyEvent || (stage.stage !== "activate" && stage.stage !== "retain"),
  );
  const unmeasurable = funnel.stages.length - measurable.length;
  const widest = Math.max(funnel.totalSessions, 1);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/*
          One bordered group rather than three loose pills: the choices are
          exclusive, and a segmented control is the shape that says so.
        */}
        <nav
          aria-label="集計する期間"
          className="inline-flex rounded-md border border-border-strong p-0.5"
        >
          {WINDOW_CHOICES.map((days) => (
            <Link
              key={days}
              href={`/products/${productId}/funnel?windowDays=${days}`}
              aria-current={days === windowDays ? "page" : undefined}
              className={cx(
                "rounded px-3 py-1 text-xs transition-colors",
                days === windowDays
                  ? "bg-accent font-medium text-accent-fg"
                  : "text-text-muted hover:text-text",
              )}
            >
              {days}日間
            </Link>
          ))}
        </nav>
        <p className="text-sm text-text-muted">
          この期間の訪問{" "}
          <span className="font-semibold tabular-nums text-text">{funnel.totalSessions}</span> 件
        </p>
      </div>

      {funnel.isColdStart ? (
        <EmptyState
          title="まだ判断できる人数が来ていません"
          body={
            <>
              この期間の訪問は {funnel.totalSessions} 件です。{funnel.coldStartMinSessions}{" "}
              件くらい集まるまで、どこで離れているかの割合はあてになりません。
              まずは人に来てもらうところからです。
            </>
          }
          action={
            <Link
              href="/settings"
              className="text-sm font-medium underline underline-offset-4"
            >
              計測用のコードを見る →
            </Link>
          }
          preview={<StagePreview />}
        />
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

                <div className="flex items-center gap-3">
                  <div
                    aria-hidden="true"
                    className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-sunken"
                  >
                    <div
                      className={cx(
                        "h-full rounded-full transition-[width]",
                        isBottleneck ? "bg-attention" : "bg-accent",
                      )}
                      style={{
                        width: `${Math.max((stage.sessions / widest) * 100, stage.sessions > 0 ? 2 : 0)}%`,
                      }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums">
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

/**
 * The shape of the real chart, with nothing in it. Shown dimmed under the
 * cold-start notice so that a first-time reader can see what this page will
 * become — the alternative was two lines of text at the top of a blank screen,
 * which reads as a page that failed to load.
 */
function StagePreview() {
  return (
    <ol className="flex flex-col gap-2">
      {ORDER.map((stage, index) => (
        <li key={stage} className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-xs">{STAGE_UI[stage].label}</span>
          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
            <span
              className="block h-full rounded-full bg-border-strong"
              style={{ width: `${100 - index * 18}%` }}
            />
          </span>
        </li>
      ))}
    </ol>
  );
}
