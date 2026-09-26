import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { TextLink } from "@/components/ui/text-link";
import { loadBrainView } from "@/core/growth/dashboard";
import { llmAvailable } from "@/core/llm";
import { findOwnedProduct } from "@/core/product/ownership";
import { requireUser } from "@/server/auth/current-user";

import { ActivityLog } from "./activity-log";
import { BrainCard, ConfidenceBadge, FactList, formatDay } from "./brain-parts";
import { FunnelCard } from "./funnel-card";
import { DIMENSION_LABELS, GOAL_METRIC_LABELS, HYPOTHESIS_STATUS_LABELS, POST_TYPE_LABELS } from "./labels";
import { OpportunityCard } from "./opportunity-card";
import { PasteOpportunity } from "./paste-opportunity";
import { RunButton } from "./run-button";
import { RunProgress } from "./run-progress";
import { StartGrowth } from "./start-growth";

export const dynamic = "force-dynamic";

/**
 * The Marketing Brain's home (spec §11). Not a tool panel — a marketer's
 * briefing: what Grape currently thinks about this product, its market and
 * its audience, the strategy it is running, the one thing to do next and
 * why, and what the last round taught it. Every number is counted and every
 * claim carries its standing (core/growth/dashboard.ts).
 */
export default async function GrowthPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await findOwnedProduct(id, (await requireUser()).id);
  if (!product) notFound();

  const brain = await loadBrainView(id);
  const base = `/products/${id}/growth`;
  const { recommendation, strategy, positioning } = brain;
  const topSegment = brain.audience[0] ?? null;

  return (
    <Page width="wide">
      <PageHeader
        title={brain.hasBrain ? "Grapeはいま、こう考えています" : "マーケティングを始める"}
        description={
          brain.hasBrain
            ? `${product.name} のマーケティングについて、Grapeが理解していること・決めたこと・学んだこと。`
            : `${product.name} のURLから、Grapeが製品・市場・顧客を理解し、戦略を立て、Xで実行して、結果から学びます。`
        }
        actions={brain.hasBrain && !brain.run ? <RunButton productId={id} focus="opportunities" label="いま見込み客を探す" /> : undefined}
      />

      {!llmAvailable() && (
        <Callout tone="attention" title="AIが未設定です">
          Grapeの分析はAIを使います。<TextLink href="/settings">設定</TextLink>でAIの接続先を選び、
          <TextLink href="/account">アカウント</TextLink>でAPIキーを登録してください。
        </Callout>
      )}

      {brain.run && <RunProgress initial={{ id: brain.run.id, status: brain.run.status, steps: brain.run.steps }} />}

      {!brain.hasBrain && !brain.run && <StartGrowth productId={id} productName={product.name} />}

      {brain.hasBrain && (
        <>
          {/* Actions — the one thing to do next, and why. */}
          <Card emphasis="attention">
            <p className="text-xs font-medium">次にやること</p>
            <p className="mt-1 text-lg font-semibold">{recommendation.headline}</p>
            <p className="mt-2 text-sm">
              <span className="font-medium">なぜ？ </span>
              {recommendation.why}
            </p>
            {recommendation.action && (
              <Link href={recommendation.action.href} className={buttonClassName("primary", "sm", "mt-3")}>
                {recommendation.action.label}
              </Link>
            )}
          </Card>

          {/* Results — the goal, and the week's funnel. */}
          <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
            <GoalCard base={base} goal={brain.goal} progress={brain.progress} />
            <Card>
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-medium text-text-muted">この7日間の投稿（{brain.week.posts}本）の結果</p>
                <TextLink href={`${base}/posts#published`} className="text-xs">
                  投稿ごとに見る
                </TextLink>
              </div>
              <div className="mt-3">
                <FunnelCard funnel={brain.week} />
              </div>
            </Card>
          </div>

          {/* What Grape thinks — product, market, audience, strategy. */}
          <div className="grid gap-4 md:grid-cols-2">
            <BrainCard
              eyebrow="Product"
              title="あなたの製品をこう理解しています"
              footer={
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-text-muted">
                  <span>
                    事実 {brain.product?.tally.known ?? 0}・仮説 {brain.product?.tally.assumption ?? 0}
                  </span>
                  {brain.product && brain.product.questions.length > 0 && (
                    <TextLink href={`${base}/brain#questions`}>Grapeからの質問 {brain.product.questions.length}件</TextLink>
                  )}
                  <TextLink href={`${base}/brain`}>くわしく</TextLink>
                </span>
              }
            >
              {brain.product?.what && <p className="text-sm font-medium">{brain.product.what.text}</p>}
              <FactList facts={brain.product?.highlights ?? []} showEvidence={false} empty="サイトから確認できた事実はまだありません。" />
            </BrainCard>

            <BrainCard eyebrow="Market" title="市場では、こんな問題が語られています" footer={<TextLink href={`${base}/brain#market`}>調査の全体を見る</TextLink>}>
              <ul className="flex flex-col gap-1.5 text-sm">
                {brain.market.pains.map((pain) => (
                  <li key={pain.id}>・ {pain.statement}</li>
                ))}
                {brain.market.pains.length === 0 && <li className="text-text-subtle">まだありません。</li>}
              </ul>
              {brain.market.phrases.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs text-text-muted">顧客自身の言葉</p>
                  <div className="flex flex-wrap gap-1.5">
                    {brain.market.phrases.map((phrase) => (
                      <span key={phrase} className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs">
                        {phrase}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </BrainCard>

            <BrainCard eyebrow="Audience" title="いちばん狙うべき相手" footer={<TextLink href={`${base}/strategy#audience`}>他の候補も見る</TextLink>}>
              {topSegment ? (
                <div className="flex flex-col gap-1.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{topSegment.name}</span>
                    <ConfidenceBadge confidence={topSegment.confidence} />
                  </div>
                  <p className="text-text-muted">{topSegment.situation}</p>
                  <p>
                    <span className="text-text-muted">困っていること: </span>
                    {topSegment.problem}
                  </p>
                  <p>
                    <span className="text-text-muted">今の手段: </span>
                    {topSegment.currentSolutions.join("、")}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-text-subtle">まだありません。</p>
              )}
            </BrainCard>

            <BrainCard eyebrow="Strategy" title="いまの戦略" footer={<TextLink href={`${base}/strategy`}>戦略の全体と変更履歴</TextLink>}>
              {strategy ? (
                <div className="flex flex-col gap-2 text-sm">
                  {positioning && <p className="font-medium">{positioning.oneLiner}</p>}
                  <p>
                    <span className="text-text-muted">中心メッセージ: </span>
                    {strategy.coreMessage}
                  </p>
                  <p>
                    <span className="text-text-muted">いま集中するチャネル: </span>
                    X
                    <span className="text-text-subtle">
                      （{strategy.channels.filter((c) => c.role === "later").map((c) => c.name).join("・") || "他"}はあとで）
                    </span>
                  </p>
                  <div className="flex flex-col gap-1">
                    <p className="text-xs text-text-muted">検証中の仮説</p>
                    {brain.experiments.filter((h) => h.status === "testing").length === 0 ? (
                      <p className="text-xs text-text-subtle">なし</p>
                    ) : (
                      brain.experiments
                        .filter((h) => h.status === "testing")
                        .map((h) => (
                          <p key={h.id} className="text-xs">
                            <Badge>{DIMENSION_LABELS[h.dimension]}</Badge> {h.statement}
                          </p>
                        ))
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-text-subtle">まだありません。</p>
              )}
            </BrainCard>
          </div>

          {/* Learning — what the results taught. */}
          <BrainCard eyebrow="Learning" title="結果から学んだこと" footer={<TextLink href={`${base}/strategy#learning`}>学びの全体と、あなたの知見を加える</TextLink>}>
            {brain.report && (
              <div className="flex flex-col gap-1 text-sm">
                <p className="font-medium">{brain.report.headline}</p>
                <ul className="flex flex-col gap-0.5 text-text-muted">
                  {brain.report.why.map((why) => (
                    <li key={why}>・ {why}</li>
                  ))}
                </ul>
              </div>
            )}
            {brain.learnings.length > 0 ? (
              <ul className="flex flex-col gap-1.5 text-sm">
                {brain.learnings.map((learning) => (
                  <li key={learning.id} className="flex items-start gap-2">
                    <Badge tone={learning.direction === "works" ? "positive" : learning.direction === "fails" ? "negative" : "neutral"}>
                      {learning.direction === "works" ? "効いた" : learning.direction === "fails" ? "効かなかった" : "未確定"}
                    </Badge>
                    <span>{learning.statement}</span>
                  </li>
                ))}
              </ul>
            ) : (
              !brain.report && (
                <p className="text-sm text-text-muted">
                  まだ学びはありません。仮説ごとに投稿が3本以上そろい、数字が入ると、何が効いたかとその理由をここに書きます。
                  {brain.experiments
                    .filter((h) => h.status === "testing" && h.result)
                    .slice(0, 1)
                    .map((h) => (
                      <span key={h.id} className="mt-1 block text-xs">
                        途中経過（{HYPOTHESIS_STATUS_LABELS[h.status]}）: {h.result!.reason}
                      </span>
                    ))}
                </p>
              )
            )}
          </BrainCard>

          {/* Execution — what goes out next, and people to talk to now. */}
          <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
            <Section id="opportunities" title="いま話しかけられる見込み客" description="狙う相手と問題が一致し、解決策を探している人の投稿です。">
              {brain.feed.length === 0 ? (
                <p className="text-sm text-text-muted">
                  関連度{brain.policy.minRelevance}%以上の会話はまだありません。毎日探します。自分で見つけた投稿は右から追加できます。
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {brain.feed.map((opportunity) => (
                    <OpportunityCard key={opportunity.id} opportunity={opportunity} productId={id} />
                  ))}
                </ul>
              )}
            </Section>
            <div className="flex flex-col gap-6">
              <Section title="これからの投稿" actions={<TextLink href={`${base}/posts`} className="text-xs">すべて見る</TextLink>}>
                {brain.upcoming.length === 0 ? (
                  <p className="text-sm text-text-muted">予定はありません。</p>
                ) : (
                  <ol className="flex flex-col divide-y divide-border rounded-md border border-border text-sm shadow-card">
                    {brain.upcoming.map((post) => (
                      <li key={post.id} className="flex gap-3 px-3 py-2">
                        <span className="w-12 shrink-0 text-xs tabular-nums text-text-subtle">{post.plannedFor?.slice(5)}</span>
                        <span className="flex flex-col">
                          <span className="text-xs text-text-muted">{POST_TYPE_LABELS[post.postType]}</span>
                          <span>{post.topic}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Section>
              <Section title="自分で見つけた会話を追加する">
                <PasteOpportunity productId={id} />
              </Section>
            </div>
          </div>

          {brain.market.moves.length > 0 && (
            <Section title="競合の動き" description="競合の公式サイトを毎日読み比べて、訴求・価格・呼びかけの変化を知らせます。">
              <ul className="flex flex-col gap-2">
                {brain.market.moves.map((move) => (
                  <li key={move.id} className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3 text-sm shadow-card">
                    <span className="text-xs text-text-subtle">{formatDay(move.createdAt)}</span>
                    <p className="whitespace-pre-line">{move.statement}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Grapeの活動" actions={<span className="text-xs text-text-subtle">新しい順</span>}>
            <ActivityLog actions={brain.activity} />
          </Section>
        </>
      )}
    </Page>
  );
}

function GoalCard({
  base,
  goal,
  progress,
}: {
  base: string;
  goal: Awaited<ReturnType<typeof loadBrainView>>["goal"];
  progress: Awaited<ReturnType<typeof loadBrainView>>["progress"];
}) {
  if (!goal || !progress) {
    return (
      <Card>
        <p className="text-xs font-medium text-text-muted">目標</p>
        <p className="mt-2 text-sm">目標がまだありません。</p>
        <TextLink href={`${base}/settings#goal`} className="mt-2 text-sm">
          目標を決める
        </TextLink>
      </Card>
    );
  }
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-text-muted">
          目標: {GOAL_METRIC_LABELS[goal.metric]} {goal.target}人
        </p>
        <TextLink href={`${base}/settings#goal`} className="text-xs">
          変更
        </TextLink>
      </div>
      {progress.blocked === "no_event" ? (
        <p className="mt-3 text-sm text-attention">
          何を「{GOAL_METRIC_LABELS[goal.metric]}」と数えるかが未設定です。
          <TextLink href={`${base}/settings#events`}>計測の設定</TextLink>でイベント名を決めてください。
        </p>
      ) : (
        <>
          <p className="mt-2 text-3xl font-semibold tabular-nums">
            {progress.current}
            <span className="text-base font-normal text-text-muted"> / {progress.target}</span>
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={progress.target} aria-valuenow={progress.current}>
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-text-muted">
            残り{progress.daysLeft}日
            {progress.neededPerDay !== null && progress.current < progress.target ? ` ・ 達成には1日あたり約${progress.neededPerDay}人` : ""}
          </p>
        </>
      )}
    </Card>
  );
}
