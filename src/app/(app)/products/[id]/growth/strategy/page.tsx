import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { tokyoDay } from "@/core/growth/policy";
import { latestReport } from "@/core/growth/steps";
import { findOwnedProduct } from "@/core/product/ownership";
import { db } from "@/db/client";
import { by } from "@/db/sort";
import { requireUser } from "@/server/auth/current-user";

import { POST_TYPE_LABELS } from "../labels";
import { RunButton } from "../run-button";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function pct(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

/**
 * The plan and what the loop has learned about it. When results change the
 * content mix, the page shows the mix before and after, with the reason —
 * the strategy is never re-weighted silently (spec §21, §34).
 */
export default async function GrowthStrategyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await findOwnedProduct(id, (await requireUser()).id);
  if (!product) notFound();

  const [strategies, report] = await Promise.all([db.strategies.find({ where: [["productId", "==", id]] }), latestReport(id)]);
  const history = strategies.sort(by((s) => s.version, "desc"));
  const strategy = history[0] ?? null;

  if (!strategy) {
    return (
      <Page>
        <PageHeader title="戦略" />
        <EmptyState title="戦略はまだありません" body="グロースのページで目標を決めると、調査のあとにAIが戦略を立てます。" />
      </Page>
    );
  }

  const today = new Date();

  return (
    <Page width="wide">
      <PageHeader
        title="戦略"
        description={`バージョン${strategy.version}（${strategy.origin === "learning" ? "結果から調整" : "調査から立案"}・${strategy.createdAt.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}）`}
        actions={
          <div className="flex gap-2">
            <RunButton productId={id} focus="learn" label="結果を分析する" />
            <RunButton productId={id} focus="research" label="調査から立て直す" />
          </div>
        }
      />

      <Section title="ポジショニング">
        <p className="rounded-md border border-border bg-surface p-4 text-base font-medium shadow-card">{strategy.positioning}</p>
        <ul className="flex flex-col gap-1 text-sm">
          {strategy.messaging.map((m) => (
            <li key={m}>・ {m}</li>
          ))}
        </ul>
        <p className="text-xs text-text-muted">
          <span className="font-medium">なぜこの戦略か: </span>
          {strategy.rationale}
        </p>
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="投稿の配分（Content Pillars）">
          <ul className="flex flex-col gap-3">
            {strategy.pillars.map((pillar) => (
              <li key={pillar.name} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{pillar.name}</span>
                  <span className="tabular-nums">{pillar.share}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${pillar.share}%` }} />
                </div>
                <p className="text-xs text-text-muted">
                  {pillar.description}（{pillar.postTypes.map((t) => POST_TYPE_LABELS[t]).join("・")}）
                </p>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="今週の投稿計画" description="固定ではありません。結果に合わせて配分と一緒に変わります。">
          <ol className="flex flex-col divide-y divide-border rounded-md border border-border text-sm shadow-card">
            {strategy.weeklyPlan.map((slot) => {
              const date = new Date(today.getTime() + slot.day * 86_400_000);
              // Noon in Japan is the same calendar day in UTC, so its UTC weekday is Japan's.
              const day = WEEKDAYS[new Date(`${tokyoDay(date)}T12:00:00+09:00`).getUTCDay()];
              return (
                <li key={slot.day} className="flex gap-3 px-3 py-2">
                  <span className="w-16 shrink-0 text-xs tabular-nums text-text-subtle">
                    {tokyoDay(date).slice(5)}（{day}）
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-xs text-text-muted">
                      {slot.pillar} ・ {POST_TYPE_LABELS[slot.postType]}
                    </span>
                    <span>{slot.topic}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </Section>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="チャネル">
          <ul className="flex flex-col gap-2 text-sm">
            {strategy.channels.map((channel) => (
              <li key={channel.name} className="flex gap-2">
                <Badge>{channel.priority}</Badge>
                <span>
                  <span className="font-medium">{channel.name}</span>
                  <span className="text-text-muted"> — {channel.rationale}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="施策">
          <p className="text-xs font-medium text-text-muted">今後2週間</p>
          <ul className="flex flex-col gap-1 text-sm">
            {strategy.shortTerm.map((item) => (
              <li key={item}>・ {item}</li>
            ))}
          </ul>
          <p className="text-xs font-medium text-text-muted">1〜3か月</p>
          <ul className="flex flex-col gap-1 text-sm">
            {strategy.midTerm.map((item) => (
              <li key={item}>・ {item}</li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="結果から分かったこと" description={report ? `${report.createdAt.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}の分析` : undefined}>
        {!report ? (
          <EmptyState title="まだ分析できる結果がありません" body="投稿を公開すると、表示・反応・サイト訪問・登録を集めて、何が効いたかをAIが分析します。" />
        ) : (
          <div className="flex flex-col gap-4">
            <Callout tone="attention" title="おすすめ">
              {report.recommendation}
            </Callout>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-text-muted">
                  <tr>
                    <th className="py-1 pr-3 font-medium">投稿タイプ</th>
                    <th className="py-1 pr-3 font-medium">本数</th>
                    <th className="py-1 pr-3 font-medium">表示</th>
                    <th className="py-1 pr-3 font-medium">反応率</th>
                    <th className="py-1 pr-3 font-medium">訪問率</th>
                    <th className="py-1 pr-3 font-medium">登録</th>
                    <th className="py-1 pr-3 font-medium">総合</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {report.stats.map((row) => (
                    <tr key={row.postType} className="border-t border-border">
                      <td className="py-1 pr-3">{POST_TYPE_LABELS[row.postType]}</td>
                      <td className="py-1 pr-3">{row.posts}</td>
                      <td className="py-1 pr-3">{row.impressions}</td>
                      <td className="py-1 pr-3">{pct(row.engagementRate)}</td>
                      <td className="py-1 pr-3">{pct(row.clickRate)}</td>
                      <td className="py-1 pr-3">{row.signups}</td>
                      <td className="py-1 pr-3">{row.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-text-subtle">総合は反応・訪問・登録を合わせた点数です（登録を最も重く見ます）。本数が少ないタイプは平均に寄せています。</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-text-muted">うまくいった理由</p>
                <ul className="mt-1 flex flex-col gap-1 text-sm">
                  {report.worked.map((w) => (
                    <li key={w}>・ {w}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium text-text-muted">うまくいかなかった理由</p>
                <ul className="mt-1 flex flex-col gap-1 text-sm">
                  {report.failed.map((f) => (
                    <li key={f}>・ {f}</li>
                  ))}
                </ul>
              </div>
            </div>
            {JSON.stringify(report.mixBefore) !== JSON.stringify(report.mixAfter) && (
              <div>
                <p className="text-xs font-medium text-text-muted">配分の変更</p>
                <ul className="mt-1 flex flex-col gap-0.5 text-sm tabular-nums">
                  {Object.keys(report.mixAfter).map((name) => (
                    <li key={name}>
                      {name}: {report.mixBefore[name] ?? 0}% → <span className="font-medium">{report.mixAfter[name]}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Section>
    </Page>
  );
}
