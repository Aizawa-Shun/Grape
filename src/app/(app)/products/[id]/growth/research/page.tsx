import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { getKnowledge } from "@/core/growth/knowledge";
import { latestCompetitors, latestIcps, latestInsights } from "@/core/growth/latest";
import { findOwnedProduct } from "@/core/product/ownership";
import type { InsightKind, SourceRef } from "@/db/schema";
import { requireUser } from "@/server/auth/current-user";

import { INSIGHT_LABELS } from "../labels";
import { RunButton } from "../run-button";
import { KnowledgeEditor } from "./knowledge-editor";

export const dynamic = "force-dynamic";

const KIND_ORDER: InsightKind[] = ["pain", "phrase", "complaint", "desired_feature", "unmet_need", "trend", "gap"];

/**
 * What the agent knows: the product (editable), the market in its users' own
 * words, the competitors, and the ICPs. Every finding says whether it was read
 * off a source during research or is the model's general knowledge — an
 * inference is shown, never passed off as fact.
 */
export default async function GrowthResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await findOwnedProduct(id, (await requireUser()).id);
  if (!product) notFound();

  const [knowledge, insights, competitors, icps] = await Promise.all([
    getKnowledge(id),
    latestInsights(id),
    latestCompetitors(id),
    latestIcps(id),
  ]);

  if (!knowledge) {
    return (
      <Page>
        <PageHeader title="市場とICP" />
        <EmptyState title="まだ調査していません" body="グロースのページで目標を決めると、AIがプロダクト・市場・競合・ICPを調べます。" />
      </Page>
    );
  }

  return (
    <Page width="wide">
      <PageHeader
        title="市場とICP"
        description="AIの理解と調査の結果です。違うところは直してください。以後のすべての提案がこれを土台にします。"
        actions={<RunButton productId={id} focus="research" label="調査をやり直す" />}
      />

      <Section
        title="あなたのSaaSをこう理解しました"
        actions={<span className="text-xs text-text-muted">{knowledge.editedByHuman ? "あなたが確認済み" : "AIの分析（未確認）"}</span>}
      >
        <Disclosure summary="内容を確認・修正する">
          <div className="pt-3">
            <KnowledgeEditor productId={id} knowledge={knowledge} />
          </div>
        </Disclosure>
        <div className="grid gap-3 md:grid-cols-2">
          <Fact title="概要">{knowledge.summary}</Fact>
          <Fact title="誰のどんな問題を">{knowledge.targetUser} ／ {knowledge.problem}</Fact>
          <Fact title="USP">{knowledge.usp.join(" ／ ") || "（なし）"}</Fact>
          <Fact title="切り口">{knowledge.marketingAngles.map((a) => a.name).join(" ／ ") || "（なし）"}</Fact>
        </div>
      </Section>

      <Section title={`ICP（${icps.length}）`} description="見込みが高い順。キーワードとXでの言い方は、見込み客探しの検索に使っています。">
        {icps.length === 0 ? (
          <p className="text-sm text-text-muted">まだありません。</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-3">
            {icps.map((icp) => (
              <li key={icp.id} className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4 text-sm shadow-card">
                <div className="flex items-center gap-2">
                  <Badge>#{icp.rank}</Badge>
                  <span className="font-medium">{icp.name}</span>
                </div>
                <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-1 text-xs">
                  <Row label="役割">{icp.role}（{icp.companySize}・技術: {icp.technicalLevel}）</Row>
                  <Row label="問題">{icp.problem}</Row>
                  <Row label="痛み">{icp.pain}</Row>
                  <Row label="ゴール">{icp.goal}</Row>
                  <Row label="きっかけ">{icp.buyingTrigger}</Row>
                  <Row label="今の手段">{icp.currentAlternatives.join(" / ")}</Row>
                  <Row label="いる場所">{icp.channels.join(" / ")}</Row>
                  <Row label="Xでの言い方">{icp.xPhrases.join(" / ")}</Row>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="市場で言われていること" description="とくに、ユーザー自身が問題をどういう言葉で表しているかに注目しています。">
        {insights.length === 0 ? (
          <p className="text-sm text-text-muted">まだありません。</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {KIND_ORDER.filter((kind) => insights.some((i) => i.kind === kind)).map((kind) => (
              <div key={kind} className="flex flex-col gap-2">
                <p className="text-xs font-medium text-text-muted">{INSIGHT_LABELS[kind]}</p>
                <ul className="flex flex-col gap-2">
                  {insights
                    .filter((i) => i.kind === kind)
                    .map((insight) => (
                      <li key={insight.id} className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3 text-sm shadow-card">
                        <p>{insight.statement}</p>
                        {insight.userPhrases.length > 0 && (
                          <p className="text-xs text-text-muted">ユーザーの言葉: {insight.userPhrases.map((p) => `「${p}」`).join(" ")}</p>
                        )}
                        <Sources sources={insight.sources} grounded={insight.grounded} />
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={`競合（${competitors.length}）`}>
        {competitors.length === 0 ? (
          <p className="text-sm text-text-muted">まだありません。</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {competitors.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4 text-sm shadow-card">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  {c.verified ? <Badge tone="positive">公式サイトを確認</Badge> : <Badge>サイト未確認</Badge>}
                  {c.xHandle && <span className="text-xs text-text-muted">{c.xHandle}</span>}
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-text-muted underline-offset-2 hover:underline">
                      サイト
                    </a>
                  )}
                </div>
                <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-1 text-xs">
                  <Row label="位置づけ">{c.positioning}</Row>
                  <Row label="対象">{c.targetAudience}</Row>
                  <Row label="訴求">{c.messaging}</Row>
                  <Row label="料金">{c.pricing}</Row>
                  <Row label="発信">{c.contentStrategy}</Row>
                  <Row label="強み">{c.strengths.join(" / ")}</Row>
                  <Row label="弱み">{c.weaknesses.join(" / ")}</Row>
                  <Row label="違い">{c.differentiation}</Row>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {insights.every((i) => !i.grounded) && insights.length > 0 && (
        <Callout>
          今回の調査はWeb検索なしで行われ、出典のある発見がありません。AIの接続先がAnthropicで、あなたのAPIキーが登録されていると、Web検索を使って出典つきで調べます。
        </Callout>
      )}
    </Page>
  );
}

function Fact({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3 text-sm shadow-card">
      <p className="text-xs font-medium text-text-muted">{title}</p>
      <p>{children}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Sources({ sources, grounded }: { sources: SourceRef[]; grounded: boolean }) {
  if (!grounded) return <p className="text-xs text-text-subtle">出典なし（AIの一般知識からの推測）</p>;
  return (
    <p className="flex flex-wrap gap-x-2 text-xs text-text-subtle">
      出典:
      {sources.slice(0, 3).map((source) => (
        <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="truncate underline-offset-2 hover:underline" title={source.title}>
          {new URL(source.url).hostname}
        </a>
      ))}
    </p>
  );
}
