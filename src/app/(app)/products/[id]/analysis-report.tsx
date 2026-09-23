import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { Section } from "@/components/ui/page";
import {
  assessmentOf,
  evidenceFor,
  type AnalysisEvidence,
  type ClaimStatus,
  type ListClaim,
  type SaasAnalysis,
  type TextClaim,
} from "@/core/context/analysis";

import { AssessmentChart } from "./assessment-chart";

/**
 * The analysis, read top-down: what this is, who for, what it costs, and only
 * then what the model made of it.
 *
 * Ordered by what someone opening the page cold needs, not by what was
 * cheapest to produce. The one-liner and category sit above the fold; the
 * model's own reasoning — strengths, differentiation, opportunities — is last
 * and visibly separated, because it is the part that is argument rather than
 * observation.
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

/** One labelled answer in the analysis table, with its standing and its evidence. */
function Row({
  label,
  status,
  evidence,
  children,
}: {
  label: string;
  status: ClaimStatus;
  evidence: AnalysisEvidence[];
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-text-muted">{label}</span>
        <StatusBadge status={status} />
      </div>
      <div className="text-sm">{children}</div>
      <Evidence items={evidence} />
    </div>
  );
}

function TextRow({
  label,
  claim,
  evidence,
}: {
  label: string;
  claim: TextClaim;
  evidence: AnalysisEvidence[];
}) {
  return (
    <Row label={label} status={claim.status} evidence={evidence}>
      {claim.value.trim() === "" ? (
        <span className="text-text-subtle">{UNKNOWN_TEXT}</span>
      ) : (
        claim.value
      )}
    </Row>
  );
}

function ListRow({
  label,
  claim,
  evidence,
}: {
  label: string;
  claim: ListClaim;
  evidence: AnalysisEvidence[];
}) {
  return (
    <Row label={label} status={claim.status} evidence={evidence}>
      {claim.items.length === 0 ? (
        <span className="text-text-subtle">{UNKNOWN_TEXT}</span>
      ) : (
        <ul className="flex flex-col gap-1">
          {claim.items.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden="true" className="text-text-subtle">
                ·
              </span>
              {item}
            </li>
          ))}
        </ul>
      )}
    </Row>
  );
}

/** The bordered, divided stack the rest of this app uses wherever rows belong together. */
function RowGroup({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border shadow-card">
      {children}
    </div>
  );
}

function InsightList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium text-text-muted">{title}</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden="true" className="text-text-subtle">
              ·
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnalysisReport({ analysis }: { analysis: SaasAnalysis }) {
  const { overview, service, targetUsers, business, market, insights } = analysis;
  // Null for every row written before scoring existed — see assessmentOf.
  const assessment = assessmentOf(analysis);
  const hasInsights =
    insights.strengths.length +
      insights.differentiation.length +
      insights.userNeeds.length +
      insights.opportunities.length >
    0;

  return (
    <>
      {/*
        Everything a reader needs in the first few seconds: the name, the
        one-line answer to "what is this", and the category. Larger type than
        anything below it, because this is the part most people will read and
        nothing else.
      */}
      {/* The name and URL are the page header's job, two lines above this —
          repeating them here cost the one-liner its place at the top. */}
      <Card className="flex flex-col gap-3">
        <p className="text-base font-medium leading-relaxed">{overview.oneLiner}</p>

        {overview.category && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-muted">カテゴリ</span>
            <Badge tone="neutral">{overview.category}</Badge>
          </div>
        )}

        <p className="text-sm leading-relaxed text-text-muted">{overview.description}</p>
      </Card>

      <Section title="このサービスについて">
        <RowGroup>
          <TextRow
            label="何をするサービスか"
            claim={service.what}
            evidence={evidenceFor(analysis, "service.what")}
          />
          <TextRow
            label="誰向けのサービスか"
            claim={service.who}
            evidence={evidenceFor(analysis, "service.who")}
          />
          <ListRow
            label="解決する課題"
            claim={service.problems}
            evidence={evidenceFor(analysis, "service.problems")}
          />
          <ListRow
            label="提供している価値"
            claim={service.valueProposition}
            evidence={evidenceFor(analysis, "service.valueProposition")}
          />
          <ListRow
            label="主な機能"
            claim={service.features}
            evidence={evidenceFor(analysis, "service.features")}
          />
          <TextRow
            label="利用方法"
            claim={service.usage}
            evidence={evidenceFor(analysis, "service.usage")}
          />
        </RowGroup>
      </Section>

      {(targetUsers.primary.length > 0 || targetUsers.secondary.length > 0) && (
        <Section title="ターゲットユーザー">
          <RowGroup>
            <ListRow
              label="主なユーザー"
              claim={{ items: targetUsers.primary, status: targetUsers.status }}
              evidence={evidenceFor(analysis, "targetUsers")}
            />
            {targetUsers.secondary.length > 0 && (
              <ListRow
                label="次点のユーザー"
                claim={{ items: targetUsers.secondary, status: targetUsers.status }}
                evidence={[]}
              />
            )}
          </RowGroup>
        </Section>
      )}

      <Section title="ビジネス">
        <RowGroup>
          <TextRow
            label="料金"
            claim={business.pricing}
            evidence={evidenceFor(analysis, "business.pricing")}
          />
          <TextRow
            label="ビジネスモデル"
            claim={business.model}
            evidence={evidenceFor(analysis, "business.model")}
          />
          <TextRow
            label="B2B / B2C"
            claim={business.audienceType}
            evidence={evidenceFor(analysis, "business.audienceType")}
          />
          <TextRow
            label="想定収益源"
            claim={business.revenueSource}
            evidence={evidenceFor(analysis, "business.revenueSource")}
          />
        </RowGroup>
      </Section>

      <Section title="市場">
        <RowGroup>
          <TextRow
            label="市場カテゴリ"
            claim={market.category}
            evidence={evidenceFor(analysis, "market.category")}
          />
          <TextRow
            label="業界"
            claim={market.industry}
            evidence={evidenceFor(analysis, "market.industry")}
          />
          <ListRow
            label="類似サービス・競合候補"
            claim={market.similarServices}
            evidence={evidenceFor(analysis, "market.similarServices")}
          />
        </RowGroup>
      </Section>

      {/*
        The turn from "what this is" to "how it is doing". Above this line
        everything is an account of the site; from here down it is judgment,
        which is why the scorecard sits on this side of the boundary and
        directly under a heading that says whose judgment it is.
      */}
      {assessment && (
        <Section
          title="現状の評価"
          description="サイトを読んだAIが、6つの観点で5段階に採点したものです。事実ではなく判断なので、違うと思ったら内容を直してください。"
        >
          <AssessmentChart assessment={assessment} />
        </Section>
      )}

      {hasInsights && (
        <Section
          title="AIによる分析"
          description="ここから下はサイトに書かれていた事実ではなく、AIが読み取って考えた内容です。"
        >
          {/*
            Visibly its own thing: the attention emphasis is the boundary
            between "the site says" and "the model thinks", and it is the only
            place on this page that gets it.
          */}
          <Card emphasis="attention" className="flex flex-col gap-4">
            <InsightList title="強み" items={insights.strengths} />
            <InsightList title="差別化ポイント" items={insights.differentiation} />
            <InsightList title="想定されるユーザーニーズ" items={insights.userNeeds} />
            <InsightList title="今後の可能性" items={insights.opportunities} />
          </Card>
        </Section>
      )}
    </>
  );
}
