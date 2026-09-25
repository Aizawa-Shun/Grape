import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { TextLink } from "@/components/ui/text-link";
import { loadGrowthDashboard } from "@/core/growth/dashboard";
import { llmAvailable } from "@/core/llm";
import { findOwnedProduct } from "@/core/product/ownership";
import { requireUser } from "@/server/auth/current-user";

import { ActivityLog } from "./activity-log";
import { OpportunityCard } from "./opportunity-card";
import { PasteOpportunity } from "./paste-opportunity";
import { RunButton } from "./run-button";
import { RunProgress } from "./run-progress";
import { StartGrowth } from "./start-growth";
import { INSIGHT_LABELS } from "./labels";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The growth home (spec §22, §23): where the goal stands, what happened this
 * week, what to do next and why, and the conversations worth joining.
 *
 * Every number here is counted (core/growth/dashboard.ts); the recommendation
 * is the latest analysis of real results, or — before there are any — the one
 * action that unblocks the loop, with its reason stated.
 */
export default async function GrowthPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await findOwnedProduct(id, (await requireUser()).id);
  if (!product) notFound();

  const dashboard = await loadGrowthDashboard(id);
  const { goal, progress, week, recommendation, feed, run } = dashboard;

  return (
    <Page width="wide">
      <PageHeader
        title="グロース"
        description="AIがあなたのSaaSのユーザーを探し、発信を続けます。あなたは案を承認するだけです。"
        actions={dashboard.hasKnowledge && !run ? <RunButton productId={id} focus="opportunities" label="いま見込み客を探す" /> : undefined}
      />

      {!llmAvailable() && (
        <Callout tone="attention" title="AIが未設定です">
          グロースの機能はAIを使います。<TextLink href="/settings">設定</TextLink>でAIの接続先を選び、<TextLink href="/account">アカウント</TextLink>でAPIキーを登録してください。
        </Callout>
      )}

      {run && <RunProgress initial={{ id: run.id, status: run.status, steps: run.steps }} />}

      {!dashboard.hasKnowledge && !run && <StartGrowth productId={id} productName={product.name} />}

      {dashboard.hasKnowledge && (
        <>
          <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
            <GoalCard productId={id} goal={goal} progress={progress} />
            <Card>
              <p className="text-xs font-medium text-text-muted">この7日間</p>
              <dl className="mt-2 grid grid-cols-3 gap-3">
                <Stat label="投稿" value={week.posts} />
                <Stat label="返信" value={week.replies} />
                <Stat label="見込み客" value={week.opportunities} />
                <Stat label="サイト訪問" value={week.visits} />
                <Stat label="登録" value={week.signups} />
              </dl>
              <p className="mt-3 text-xs text-text-subtle">訪問と登録は、Grapeの投稿のリンクから来た分だけを数えています。</p>
            </Card>
          </div>

          <Card emphasis="attention">
            <p className="text-xs font-medium">AIのおすすめ</p>
            <p className="mt-1 text-base font-semibold">{recommendation.headline}</p>
            <p className="mt-2 text-sm">
              <span className="font-medium">なぜ？ </span>
              {recommendation.why}
            </p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              {dashboard.approvals.length > 0 && (
                <Link href={`/products/${id}/growth/posts#drafts`} className={buttonClassName("primary", "sm")}>
                  承認待ちの案を見る（{dashboard.approvals.length}）
                </Link>
              )}
              <Link href={`/products/${id}/growth/strategy`} className={buttonClassName("secondary", "sm")}>
                戦略を見る
              </Link>
            </div>
          </Card>

          <Section
            title="見つけた見込み客（Opportunity Feed）"
            description={
              feed.length > 0
                ? `ICPと問題が一致する会話が${feed.length}件あり、そのうち${dashboard.highIntentCount}件は今まさに解決策を探しています。`
                : undefined
            }
          >
            {feed.length === 0 ? (
              <EmptyState
                title="いま表示できる見込み客はいません"
                body={`関連度${dashboard.policy.minRelevance}%以上の会話が見つかると、ここに理由と一緒に出ます。毎日自動で探します。XのAPIを設定していない場合は、自分で見つけた投稿を下から追加できます。`}
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {feed.map((opportunity) => (
                  <OpportunityCard key={opportunity.id} opportunity={opportunity} productId={id} />
                ))}
              </ul>
            )}
          </Section>

          {dashboard.contentIdeas.length > 0 && (
            <Section title="投稿のネタになりそうなこと" description="市場調査と競合調査で見つかった、まだ誰も十分に言っていないこと。">
              <ul className="grid gap-3 md:grid-cols-2">
                {dashboard.contentIdeas.map((idea) => (
                  <li key={idea.id} className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-3 text-sm shadow-card">
                    <Badge>{INSIGHT_LABELS[idea.kind]}</Badge>
                    <p>{idea.statement}</p>
                    {!idea.grounded && <p className="text-xs text-text-subtle">出典なし（AIの一般知識からの推測）</p>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <div className="grid gap-6 md:grid-cols-2">
            <Section title="自分で見つけた会話を追加する">
              <PasteOpportunity productId={id} />
            </Section>
            <Section title="AIの活動" actions={<span className="text-xs text-text-subtle">新しい順</span>}>
              <ActivityLog actions={dashboard.activity} />
            </Section>
          </div>
        </>
      )}
    </Page>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function GoalCard({
  productId,
  goal,
  progress,
}: {
  productId: string;
  goal: Awaited<ReturnType<typeof loadGrowthDashboard>>["goal"];
  progress: Awaited<ReturnType<typeof loadGrowthDashboard>>["progress"];
}) {
  if (!goal || !progress) {
    return (
      <Card>
        <p className="text-xs font-medium text-text-muted">目標</p>
        <p className="mt-2 text-sm">目標がまだありません。</p>
        <TextLink href={`/products/${productId}/growth/settings#goal`} className="mt-2 text-sm">
          目標を決める
        </TextLink>
      </Card>
    );
  }
  const unit = goal.metric === "signups" ? "登録" : "訪問者";
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-text-muted">目標: {unit} {goal.target}人</p>
        <TextLink href={`/products/${productId}/growth/settings#goal`} className="text-xs">
          変更
        </TextLink>
      </div>
      {progress.blocked === "no_key_event" ? (
        <p className="mt-3 text-sm text-attention">
          どのイベントが「登録」かが未設定なので、まだ数えられません。<TextLink href={`/settings?product=${productId}`}>計測の設定</TextLink>でキーイベントを決めてください。
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
