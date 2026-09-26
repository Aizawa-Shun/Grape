import { notFound } from "next/navigation";

import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { TextLink } from "@/components/ui/text-link";
import { xCredentialsFrom } from "@/core/action/channels/x";
import { attributionFor } from "@/core/growth/attribution";
import { getPolicy } from "@/core/growth/policy";
import { findOwnedProduct } from "@/core/product/ownership";
import { loadSettings } from "@/core/settings";
import { db } from "@/db/client";
import { by } from "@/db/sort";
import { env } from "@/env";
import { requireUser } from "@/server/auth/current-user";

import { POST_TYPE_LABELS } from "../labels";
import { PostCard } from "../post-card";
import { RejectIdea } from "../reject-idea";
import { RunButton } from "../run-button";

export const dynamic = "force-dynamic";

const APPROVAL_COPY = {
  manual: "手動: 案は、あなたが頼んだときだけ作ります。出すものはすべてあなたが承認します。",
  assisted: "アシスト: AIが毎日案を作り、あなたが承認したものだけが出ていきます。",
  autonomous: "自律: 設定したルールの範囲で、AIが承認なしで実行します（練習モード中は送信されません）。",
} as const;

/**
 * Drafts waiting on a decision, and what the published ones did. The approval
 * queue is first because it is the one thing on this page only the person can
 * move forward.
 */
export default async function GrowthPostsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await findOwnedProduct(id, (await requireUser()).id);
  if (!product) notFound();

  const [settings, policy, posts, opportunities] = await Promise.all([
    loadSettings(),
    getPolicy(id),
    db.posts.find({ where: [["productId", "==", id]] }),
    db.opportunities.find({ where: [["productId", "==", id]] }),
  ]);
  const xSource = new Set(opportunities.filter((o) => o.source === "x").map((o) => o.id));
  const viaX = (post: (typeof posts)[number]) => post.kind === "post" || (post.opportunityId !== null && xSource.has(post.opportunityId));
  const xConfigured = xCredentialsFrom(env) !== null;

  const hypotheses = new Map((await db.hypotheses.find({ where: [["productId", "==", id]] })).map((h) => [h.id, h]));
  const ideas = posts.filter((p) => p.status === "idea").sort(by((p) => p.plannedFor ?? "9999"));
  const waiting = posts
    .filter((p) => p.status === "draft" || p.status === "failed" || (p.status === "approved" && !p.publishedAt))
    .sort(by((p) => p.plannedFor ?? p.createdAt.toISOString()));
  const published = posts.filter((p) => p.status === "published").sort(by((p) => p.publishedAt ?? p.createdAt, "desc"));
  const rejected = posts.filter((p) => p.status === "rejected").sort(by((p) => p.decidedAt ?? p.createdAt, "desc")).slice(0, 10);
  const attribution = await attributionFor(id, published);

  const card = (post: (typeof posts)[number]) => (
    <PostCard
      key={post.id}
      post={post}
      viaX={viaX(post)}
      dryRun={settings.GRAPE_ACTION_DRY_RUN}
      xConfigured={xConfigured}
      attribution={
        post.status === "published"
          ? { visits: attribution.get(post.id)?.visits ?? 0, signups: product.signupEventName ? (attribution.get(post.id)?.signups ?? 0) : null }
          : null
      }
      hypothesis={post.hypothesisId ? (hypotheses.get(post.hypothesisId)?.subject ?? null) : null}
    />
  );

  return (
    <Page>
      <PageHeader
        title="投稿"
        description="仮説を確かめるための投稿です。直してから承認できます。見送った理由と直した内容は、次の案に活かされます。"
        actions={<RunButton productId={id} focus="content" label="ネタと下書きを補充する" />}
      />

      <Callout>
        {APPROVAL_COPY[policy.approvalMode]}{" "}
        <TextLink href={`/products/${id}/growth/settings`}>変更</TextLink>
        {settings.GRAPE_ACTION_DRY_RUN && (
          <>
            <br />
            練習モードがオンです。承認してもXには送信されません（<TextLink href="/settings">設定</TextLink>で切り替え）。
          </>
        )}
      </Callout>

      <Section id="drafts" title={`承認待ち（${waiting.length}）`}>
        {waiting.length === 0 ? (
          <EmptyState title="承認を待っている案はありません" body="戦略の週間計画に沿って、毎日新しい案を補充します。「いま案を作る」ですぐに作ることもできます。" />
        ) : (
          <ul className="flex flex-col gap-3">{waiting.map(card)}</ul>
        )}
      </Section>

      <Section id="upcoming" title={`これからのネタ（${ideas.length}）`} description="検証中の仮説ごとに出したネタです。予定日の2日前に下書きになります。要らないネタは取り下げてください。">
        {ideas.length === 0 ? (
          <p className="text-sm text-text-muted">予定しているネタはありません。</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-sm shadow-card">
            {ideas.map((idea) => (
              <li key={idea.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="w-14 shrink-0 text-xs tabular-nums text-text-subtle">{idea.plannedFor?.slice(5) ?? "未定"}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-xs text-text-muted">
                    {POST_TYPE_LABELS[idea.postType]}
                    {idea.hypothesisId && hypotheses.get(idea.hypothesisId) ? ` ・ 仮説「${hypotheses.get(idea.hypothesisId)!.subject}」` : ""}
                  </span>
                  <span>{idea.topic}</span>
                </span>
                <RejectIdea postId={idea.id} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="published" title={`公開済み（${published.length}）`} description="表示や反応はXから（APIが無ければ手入力で）、訪問と登録はサイトの計測コードから数えています。">
        {published.length === 0 ? (
          <p className="text-sm text-text-muted">まだありません。</p>
        ) : (
          <ul className="flex flex-col gap-3">{published.map(card)}</ul>
        )}
      </Section>

      {rejected.length > 0 && (
        <Section title="見送った案">
          <ul className="flex flex-col gap-3">{rejected.map(card)}</ul>
        </Section>
      )}
    </Page>
  );
}
