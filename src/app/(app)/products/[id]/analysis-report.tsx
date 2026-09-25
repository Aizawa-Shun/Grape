import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { Section } from "@/components/ui/page";
import {
  assessmentOf,
  claimStatusTally,
  evidenceFor,
  overallScore,
  positioningOf,
  swotOf,
  type AnalysisEvidence,
  type ClaimStatus,
  type ListClaim,
  type SaasAnalysis,
  type TextClaim,
} from "@/core/context/analysis";

import { AssessmentChart } from "./assessment-chart";
import { PositioningMap } from "./positioning-map";
import { ScoreRing, StatusTallyBar, SwotMatrix, ValueChain } from "./report-figures";

/**
 * The analysis as a report rather than a list of findings: a summary with the
 * overall score, then one figure per question — how the site scores, how its
 * problems, value and features connect, who it is for, how it makes money,
 * where it sits among similar services, and the model's SWOT reading.
 *
 * Ordered by what someone opening the page cold needs. The headline and the
 * scores lead; the model's own reasoning is last and visibly separated,
 * because it is the part that is argument rather than observation.
 *
 * Every claim carries its standing as a small badge, and cites its evidence
 * behind a disclosure. Both are deliberately quiet: a page that shouts
 * "AI推定" at every line is one nobody reads, and a page that hides it is one
 * that passes inference off as fact. The badge is the smallest thing on each
 * row, and always present.
 */

const STATUS_UI: Record<ClaimStatus, { label: string; tone: "neutral" | "attention" }> = {
  // "確認済み" gets the quietest treatment of the three — it is the default
  // and needs no attention drawn to it.
  confirmed: { label: "確認済み", tone: "neutral" },
  inferred: { label: "AI推定", tone: "attention" },
  unknown: { label: "未確認", tone: "neutral" },
};

function StatusBadge({ status }: { status: ClaimStatus }) {
  const { label, tone } = STATUS_UI[status];
  return (
    <Badge tone={tone} className="shrink-0">
      {label}
    </Badge>
  );
}

/**
 * What a claim with nothing in it falls back to.
 *
 * Rarely reached now: an analysis fills every field whatever its status, so a
 * claim the site never stated arrives as the model's best reading with a
 * 未確認 badge beside it rather than as a blank. This covers the older rows
 * that were written when `unknown` meant an empty value, and a model that
 * returns one in spite of the schema.
 */
const UNKNOWN_TEXT = "未確認";

function Evidence({ items }: { items: AnalysisEvidence[] }) {
  if (items.length === 0) return null;

  return (
    <Disclosure summary={`根拠を見る（${items.length}）`}>
      <ul className="flex flex-col gap-2.5 border-l-2 border-border pl-3">
        {items.map((item, index) => (
          <li key={`${item.url}-${index}`} className="flex flex-col gap-1">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-xs text-text-subtle hover:underline"
            >
              {item.url}
            </a>
            <blockquote className="border-l-2 border-border-strong pl-2 text-xs text-text-muted">
              {item.quote}
            </blockquote>
            <p className="text-xs text-text-muted">{item.reasoning}</p>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

/** One answer as a tile: label, standing, the answer, and its evidence. */
function Tile({
  label,
  status,
  evidence,
  children,
  className,
}: {
  label: string;
  status: ClaimStatus;
  evidence: AnalysisEvidence[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={["flex flex-col gap-2", className].filter(Boolean).join(" ")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-muted">{label}</span>
        <StatusBadge status={status} />
      </div>
      <div className="text-sm leading-relaxed">{children}</div>
      <Evidence items={evidence} />
    </Card>
  );
}

function textOf(claim: TextClaim): ReactNode {
  return claim.value.trim() === "" ? <span className="text-text-subtle">{UNKNOWN_TEXT}</span> : claim.value;
}

function itemsOf(claim: ListClaim): string[] {
  return claim.items.length === 0 ? [UNKNOWN_TEXT] : claim.items;
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-1.5 text-sm leading-relaxed">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span aria-hidden="true" className="text-text-subtle">
            ·
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

export function AnalysisReport({ analysis }: { analysis: SaasAnalysis }) {
  const { overview, service, targetUsers, business, market, insights } = analysis;
  // Null for every row written before scoring / the map existed.
  const assessment = assessmentOf(analysis);
  const positioning = positioningOf(analysis);
  const swot = swotOf(analysis);
  const tally = claimStatusTally(analysis);
  const hasSwot =
    swot.strengths.length + swot.weaknesses.length + swot.opportunities.length + swot.threats.length > 0;

  return (
    <>
      {/* The name and URL are the page header's job, two lines above this. */}
      <Card className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {overview.category && <Badge tone="neutral">{overview.category}</Badge>}
              {market.industry.value.trim() && market.industry.value.length <= 24 && (
                <Badge tone="neutral">{market.industry.value}</Badge>
              )}
            </div>
            <p className="text-xl font-semibold leading-snug tracking-tight">{overview.oneLiner}</p>
            <p className="text-sm leading-relaxed text-text-muted">{overview.description}</p>
          </div>
          {assessment && (
            <div className="shrink-0 self-center sm:self-start">
              <ScoreRing score={overallScore(assessment)} label="サイトの総合評価" />
            </div>
          )}
        </div>
        <div className="border-t border-border pt-4">
          <StatusTallyBar tally={tally} />
        </div>
      </Card>

      {assessment && (
        <Section
          title="現状の評価"
          description="サイトを読んだAIが、6つの観点で5段階に採点したものです。事実ではなく判断なので、違うと思ったら内容を直してください。"
        >
          <AssessmentChart assessment={assessment} />
        </Section>
      )}

      <Section title="サービスの全体像" description="解決する課題から、提供する価値、それを支える機能までのつながり。">
        <ValueChain
          steps={[
            {
              title: "解決する課題",
              caption: "利用者が抱えている問題",
              items: itemsOf(service.problems),
              badge: <StatusBadge status={service.problems.status} />,
              footer: <Evidence items={evidenceFor(analysis, "service.problems")} />,
            },
            {
              title: "提供している価値",
              caption: "その問題に対して約束していること",
              items: itemsOf(service.valueProposition),
              badge: <StatusBadge status={service.valueProposition.status} />,
              footer: <Evidence items={evidenceFor(analysis, "service.valueProposition")} />,
            },
            {
              title: "主な機能",
              caption: "約束を実際に支えているもの",
              items: itemsOf(service.features),
              badge: <StatusBadge status={service.features.status} />,
              footer: <Evidence items={evidenceFor(analysis, "service.features")} />,
            },
          ]}
        />
        <div className="grid gap-3 md:grid-cols-3">
          <Tile label="何をするサービスか" status={service.what.status} evidence={evidenceFor(analysis, "service.what")}>
            {textOf(service.what)}
          </Tile>
          <Tile label="誰向けのサービスか" status={service.who.status} evidence={evidenceFor(analysis, "service.who")}>
            {textOf(service.who)}
          </Tile>
          <Tile label="利用方法" status={service.usage.status} evidence={evidenceFor(analysis, "service.usage")}>
            {textOf(service.usage)}
          </Tile>
        </div>
      </Section>

      {(targetUsers.primary.length > 0 || targetUsers.secondary.length > 0) && (
        <Section
          title="ターゲットユーザー"
          actions={<StatusBadge status={targetUsers.status} />}
        >
          {/* Two tiers, sized by priority: the primary audience is who the
              site should be written for, the secondary who else it reaches. */}
          <div className="grid gap-3 md:grid-cols-[3fr_2fr]">
            <Card className="flex flex-col gap-3 border-accent/40">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-fg">主</span>
                <span className="text-xs font-medium text-text-muted">主なユーザー</span>
              </div>
              <ul className="flex flex-col gap-2">
                {targetUsers.primary.map((user) => (
                  <li key={user} className="rounded-md bg-surface-sunken px-3 py-2 text-sm font-medium leading-relaxed">
                    {user}
                  </li>
                ))}
              </ul>
              <Evidence items={evidenceFor(analysis, "targetUsers")} />
            </Card>
            {targetUsers.secondary.length > 0 && (
              <Card className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-text-muted">次点</span>
                  <span className="text-xs font-medium text-text-muted">次に届く人</span>
                </div>
                <BulletList items={targetUsers.secondary} />
              </Card>
            )}
          </div>
        </Section>
      )}

      <Section title="ビジネスモデル">
        <div className="grid gap-3 sm:grid-cols-2">
          <Tile label="料金" status={business.pricing.status} evidence={evidenceFor(analysis, "business.pricing")}>
            {textOf(business.pricing)}
          </Tile>
          <Tile label="課金の形" status={business.model.status} evidence={evidenceFor(analysis, "business.model")}>
            {textOf(business.model)}
          </Tile>
          <Tile label="B2B / B2C" status={business.audienceType.status} evidence={evidenceFor(analysis, "business.audienceType")}>
            {textOf(business.audienceType)}
          </Tile>
          <Tile label="想定収益源" status={business.revenueSource.status} evidence={evidenceFor(analysis, "business.revenueSource")}>
            {textOf(business.revenueSource)}
          </Tile>
        </div>
      </Section>

      <Section
        title="市場とポジション"
        description={
          positioning
            ? "類似サービスとの位置関係を、それらが最も分かれる2つの観点で図にしたものです（AIによる推定）。"
            : undefined
        }
        actions={<StatusBadge status={positioning?.status ?? market.similarServices.status} />}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Tile label="市場カテゴリ" status={market.category.status} evidence={evidenceFor(analysis, "market.category")}>
            {textOf(market.category)}
          </Tile>
          <Tile label="業界" status={market.industry.status} evidence={evidenceFor(analysis, "market.industry")}>
            {textOf(market.industry)}
          </Tile>
        </div>
        {positioning ? (
          <Card className="flex flex-col gap-3 p-5">
            <PositioningMap positioning={positioning} />
            <Evidence items={evidenceFor(analysis, "market.similarServices")} />
          </Card>
        ) : (
          // An analysis from before the map existed: the similar services as
          // cards, and a note that reading the site again draws the map.
          <Card className="flex flex-col gap-3">
            <span className="text-xs font-medium text-text-muted">類似サービス・競合候補</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {itemsOf(market.similarServices).map((item) => (
                <div key={item} className="rounded-md bg-surface-sunken px-3 py-2.5 text-sm leading-relaxed">
                  {item}
                </div>
              ))}
            </div>
            <p className="text-xs text-text-subtle">サイトを読み直すと、類似サービスとの位置関係を図で表示します。</p>
            <Evidence items={evidenceFor(analysis, "market.similarServices")} />
          </Card>
        )}
      </Section>

      {(hasSwot || insights.differentiation.length + insights.userNeeds.length > 0) && (
        <Section
          title="AIによる分析"
          description="ここから下はサイトに書かれていた事実ではなく、AIが読み取って考えた内容です。"
        >
          {hasSwot && <SwotMatrix {...swot} />}
          <div className="grid gap-3 md:grid-cols-2">
            {insights.differentiation.length > 0 && (
              <Card emphasis="attention" className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-text-muted">差別化ポイント</h3>
                <BulletList items={insights.differentiation} />
              </Card>
            )}
            {insights.userNeeds.length > 0 && (
              <Card className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-text-muted">想定されるユーザーニーズ</h3>
                <BulletList items={insights.userNeeds} />
              </Card>
            )}
          </div>
        </Section>
      )}
    </>
  );
}
