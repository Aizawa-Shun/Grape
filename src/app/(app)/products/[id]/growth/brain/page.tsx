import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { LIST_TOPICS, tally, TOPIC_LABELS } from "@/core/growth/facts";
import { getKnowledge } from "@/core/growth/knowledge";
import { latestCompetitors, latestInsights } from "@/core/growth/latest";
import { findOwnedProduct } from "@/core/product/ownership";
import type { InsightKind, SourceRef } from "@/db/schema";
import { requireUser } from "@/server/auth/current-user";

import { BrainCard, FactList, safeHost } from "../brain-parts";
import { INSIGHT_LABELS } from "../labels";
import { RunButton } from "../run-button";
import { KnowledgeEditor } from "./knowledge-editor";
import { QuestionsForm } from "./questions-form";

export const dynamic = "force-dynamic";

const MARKET_ORDER: InsightKind[] = ["pain", "phrase", "complaint", "search_demand", "desired_feature", "unmet_need", "community", "trend", "gap"];

/**
 * Product Knowledge and Market Knowledge (spec §3, §4) — the two halves of
 * the Brain everything else stands on. Every product fact says whether it is
 * known (and from where) or assumed; what is not known is a question.
 */
export default async function BrainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await findOwnedProduct(id, (await requireUser()).id);
  if (!product) notFound();

  const [knowledge, insights, competitors] = await Promise.all([getKnowledge(id), latestInsights(id), latestCompetitors(id)]);
  if (!knowledge) {
    return (
      <Page>
        <PageHeader title="製品と市場" />
        <EmptyState title="まだ分析していません" body="グロースのページで目標を決めると、Grapeが製品と市場を調べます。" />
      </Page>
    );
  }
  const counts = tally(knowledge);

  return (
    <Page width="wide">
      <PageHeader
        title="製品と市場"
        description="Grapeが理解していることと、調べたこと。事実と推測は必ず分けて示します。"
        actions={<RunButton productId={id} focus="research" label="市場を調べ直す" />}
      />

      <Section
        title="あなたの製品について"
        description={`サイトかあなたの回答で確認できた事実 ${counts.known}件、Grapeの推測 ${counts.assumption}件。推測は、投稿で事実のようには書きません。`}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <BrainCard eyebrow={TOPIC_LABELS.what}>
            <FactList facts={knowledge.what ? [knowledge.what] : []} />
          </BrainCard>
          {LIST_TOPICS.map((topic) => (
            <BrainCard key={topic} eyebrow={TOPIC_LABELS[topic]}>
              <FactList facts={knowledge[topic]} />
            </BrainCard>
          ))}
        </div>
        <Disclosure summary="内容を直す・確定する">
          <div className="pt-3">
            <KnowledgeEditor productId={id} knowledge={knowledge} />
          </div>
        </Disclosure>
      </Section>

      <Section id="questions" title="Grapeからの質問" description="サイトからは分からなかったことです。答えると、推測ではなく事実として使えます。">
        <QuestionsForm productId={id} questions={knowledge.questions} />
      </Section>

      <Section id="market" title="市場で語られていること" description="とくに、顧客が自分の問題をどんな言葉で書いているかを集めています。">
        {insights.length === 0 ? (
          <p className="text-sm text-text-muted">まだありません。</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {MARKET_ORDER.filter((kind) => insights.some((i) => i.kind === kind)).map((kind) => (
              <div key={kind} className="flex flex-col gap-2">
                <p className="text-xs font-medium text-text-muted">{INSIGHT_LABELS[kind]}</p>
                <ul className="flex flex-col gap-2">
                  {insights
                    .filter((i) => i.kind === kind)
                    .map((insight) => (
                      <li key={insight.id} className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3 text-sm shadow-card">
                        <p>{insight.statement}</p>
                        {insight.userPhrases.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {insight.userPhrases.map((phrase) => (
                              <span key={phrase} className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs">
                                {phrase}
                              </span>
                            ))}
                          </div>
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
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-text-muted underline-offset-2 hover:underline">
                      {safeHost(c.url)}
                    </a>
                  )}
                </div>
                <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-xs">
                  <Row label="位置づけ">{c.positioning}</Row>
                  <Row label="対象">{c.targetAudience}</Row>
                  <Row label="訴求">{c.messaging}</Row>
                  <Row label="料金">{c.pricing}</Row>
                  <Row label="弱み">{c.weaknesses.join(" / ")}</Row>
                  <Row label="違い">{c.differentiation}</Row>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
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
  if (!grounded) return <p className="text-xs text-text-subtle">出典なし（Grapeの一般知識からの推測）</p>;
  return (
    <p className="flex flex-wrap gap-x-2 text-xs text-text-subtle">
      出典:
      {sources.slice(0, 3).map((source) => (
        <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline" title={source.title}>
          {safeHost(source.url)}
        </a>
      ))}
    </p>
  );
}
