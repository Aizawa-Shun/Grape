import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { activeLearnings, allHypotheses, latestSegments, strategyHistory } from "@/core/growth/latest";
import { findOwnedProduct } from "@/core/product/ownership";
import { db } from "@/db/client";
import { by } from "@/db/sort";
import { requireUser } from "@/server/auth/current-user";

import { BrainCard, ConfidenceBadge, formatDay, pct } from "../brain-parts";
import { DIMENSION_LABELS, HYPOTHESIS_STATUS_LABELS, POST_TYPE_LABELS } from "../labels";
import { RunButton } from "../run-button";
import { OwnerLearningForm, RetireButton } from "./learning-forms";

export const dynamic = "force-dynamic";

/**
 * Audience → positioning → strategy → experiments → learnings (spec §5–§9),
 * on one page, because each is the reason for the next. When the strategy
 * changes, the page says what changed and which learning made it change.
 */
export default async function StrategyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await findOwnedProduct(id, (await requireUser()).id);
  if (!product) notFound();

  const [segments, history, hypotheses, learnings, retired] = await Promise.all([
    latestSegments(id),
    strategyHistory(id),
    allHypotheses(id),
    activeLearnings(id),
    db.learnings.find({ where: [["productId", "==", id], ["status", "==", "superseded"]] }),
  ]);
  const strategy = history[0] ?? null;

  if (!strategy) {
    return (
      <Page>
        <PageHeader title="戦略と学び" />
        <EmptyState title="戦略はまだありません" body="グロースのページで目標を決めると、調査のあとにGrapeが戦略を立てます。" />
      </Page>
    );
  }
  const p = strategy.positioning;
  const posts = await db.posts.find({ where: [["productId", "==", id]] });
  const postsFor = (hypothesisId: string) => posts.filter((post) => post.hypothesisId === hypothesisId && post.status !== "rejected");

  return (
    <Page width="wide">
      <PageHeader
        title="戦略と学び"
        description={`戦略 v${strategy.version}（${strategy.origin === "revision" ? "結果から改訂" : "調査から立案"}・${formatDay(strategy.createdAt)}）`}
        actions={
          <div className="flex gap-2">
            <RunButton productId={id} focus="learn" label="結果から学ぶ" />
            <RunButton productId={id} focus="research" label="調査から立て直す" />
          </div>
        }
      />

      <Section id="audience" title="誰に売るか（Audience）" description="調査から立てた仮説です。確度は、根拠にした実際の書き込みの数で決まります。">
        <div className="grid gap-3 md:grid-cols-3">
          {segments.map((segment) => (
            <BrainCard key={segment.id} eyebrow={segment.rank === 1 ? "最優先" : `候補 ${segment.rank}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{segment.name}</span>
                <ConfidenceBadge confidence={segment.confidence} />
              </div>
              <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-xs">
                <Row label="場面">{segment.situation}</Row>
                <Row label="問題">{segment.problem}</Row>
                <Row label="痛み">{segment.pain}</Row>
                <Row label="動機">{segment.motivation}</Row>
                <Row label="今の手段">{segment.currentSolutions.join(" / ")}</Row>
                <Row label="合う理由">{segment.fitReason}</Row>
                <Row label="いる場所">{segment.channels.join(" / ")}</Row>
              </dl>
            </BrainCard>
          ))}
        </div>
      </Section>

      <Section title="何として売るか（Positioning）">
        <BrainCard eyebrow={p.segmentName} title={p.oneLiner}>
          <dl className="grid grid-cols-[9.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            <Row label="For（誰のために）">{p.forWhom}</Row>
            <Row label="Who（問題）">{p.problem}</Row>
            <Row label="Our product">{p.product}</Row>
            <Row label="Unlike（比べる相手）">{p.alternatives.join("、")}</Row>
            <Row label="Because（理由）">
              <ul className="flex flex-col gap-1">
                {p.because.map((b) => (
                  <li key={b.text} className="flex items-start gap-2">
                    {b.status === "known" ? <Badge tone="positive">確認済み</Badge> : <Badge tone="attention">仮説</Badge>}
                    <span>{b.text}</span>
                  </li>
                ))}
              </ul>
            </Row>
          </dl>
          {p.because.some((b) => b.status === "assumption") && (
            <p className="text-xs text-attention">選ばれる理由の一部が仮説です。「製品と市場」で事実を確定すると、ポジショニングが強くなります。</p>
          )}
        </BrainCard>
      </Section>

      <Section title="どうやって売るか（Strategy）">
        <div className="grid gap-4 md:grid-cols-2">
          <BrainCard eyebrow="Core message" title={strategy.coreMessage}>
            <ul className="flex flex-col gap-1 text-sm">
              {strategy.supportingMessages.map((m) => (
                <li key={m}>・ {m}</li>
              ))}
            </ul>
            <p className="text-xs text-text-muted">
              <span className="font-medium">理由: </span>
              {strategy.rationale}
            </p>
          </BrainCard>
          <BrainCard eyebrow="Channels" title="いまはXに集中します">
            <ul className="flex flex-col gap-2 text-sm">
              {strategy.channels.map((channel) => (
                <li key={channel.name} className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <Badge tone={channel.role === "focus" ? "positive" : "neutral"}>{channel.role === "focus" ? "集中" : "あとで"}</Badge>
                    <span className="font-medium">{channel.name}</span>
                  </span>
                  <span className="text-xs text-text-muted">{channel.rationale}</span>
                  {channel.startWhen && <span className="text-xs text-text-subtle">始める条件: {channel.startWhen}</span>}
                </li>
              ))}
            </ul>
          </BrainCard>
          <BrainCard eyebrow="Content pillars" title="発信の柱">
            <ul className="flex flex-col gap-3">
              {strategy.pillars.map((pillar) => (
                <li key={pillar.name} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between text-sm">
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
          </BrainCard>
          <BrainCard eyebrow="Acquisition / Conversion / Retention">
            <List title="獲得（Xで）" items={strategy.acquisition} />
            <List title="登録につなげる" items={strategy.conversion} />
            <List title="続けてもらう・紹介してもらう" items={strategy.retentionReferral} />
          </BrainCard>
        </div>

        {history.length > 1 && (
          <BrainCard eyebrow="History" title="戦略の変更履歴">
            <ol className="flex flex-col gap-3">
              {history
                .filter((s) => s.origin === "revision" || s.version === 1)
                .map((s) => (
                  <li key={s.id} className="flex flex-col gap-1 text-sm">
                    <span className="text-xs text-text-subtle">
                      v{s.version}・{formatDay(s.createdAt)}・{s.origin === "revision" ? "結果から改訂" : "最初の戦略"}
                    </span>
                    {s.changes.length > 0 ? (
                      <ul className="flex flex-col gap-0.5">
                        {s.changes.map((c) => (
                          <li key={c.what}>
                            ・ {c.what}
                            <span className="text-xs text-text-muted">（根拠: {c.because}）</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span>調査から立案</span>
                    )}
                  </li>
                ))}
            </ol>
          </BrainCard>
        )}
      </Section>

      <Section id="experiments" title="検証している仮説（Experiments）" description="仮説ごとに投稿を書き、他の投稿と数字で比べます。判定はGrapeのコードが数字だけで行い、AIは理由を書くだけです。">
        {hypotheses.length === 0 ? (
          <p className="text-sm text-text-muted">まだありません。</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {hypotheses
              .sort(by((h) => (h.status === "testing" ? 0 : 1)))
              .map((h) => {
                const own = postsFor(h.id);
                const published = own.filter((post) => post.status === "published").length;
                return (
                  <li key={h.id} className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4 shadow-card">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{DIMENSION_LABELS[h.dimension]}</Badge>
                      <Badge tone={h.status === "supported" ? "positive" : h.status === "refuted" ? "negative" : h.status === "testing" ? "attention" : "neutral"}>
                        {HYPOTHESIS_STATUS_LABELS[h.status]}
                      </Badge>
                      <span className="text-xs text-text-subtle">
                        公開 {published} / 目標 {h.targetPosts}本
                      </span>
                      {h.status === "testing" && (
                        <span className="ml-auto">
                          <RetireButton
                            path={`/api/growth/${id}/hypotheses/${h.id}/retire`}
                            label="この検証をやめる"
                            confirm="この仮説の検証をやめますか？ 予定していたネタも取り下げます。"
                          />
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium">{h.statement}</p>
                    <p className="text-xs text-text-muted">
                      根拠: {h.basis} ／ 正しければ: {h.expected}
                    </p>
                    {h.result && (
                      <div className="rounded-md bg-surface-sunken px-3 py-2 text-xs">
                        <p>{h.result.reason}</p>
                        <p className="mt-1 text-text-subtle tabular-nums">
                          この仮説: 反応率 {pct(h.result.engagementRate)}・表示→訪問 {pct(h.result.clickRate)}・訪問→登録 {pct(h.result.signupRate)}
                          ／ 他の投稿: {pct(h.result.baseline.engagementRate)}・{pct(h.result.baseline.clickRate)}・{pct(h.result.baseline.signupRate)}
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </Section>

      <Section id="learning" title="この製品について学んだこと（Learning）" description="実験の結果と、あなたの知見。次の戦略と投稿は、すべてここを読んでから作られます。">
        {learnings.length === 0 ? (
          <Callout>まだ学びはありません。仮説の検証に結論が出ると、何が効いたかと、なぜそうなったかをここに書きます。</Callout>
        ) : (
          <ul className="flex flex-col gap-2">
            {learnings.map((l) => (
              <li key={l.id} className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3 text-sm shadow-card">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={l.direction === "works" ? "positive" : l.direction === "fails" ? "negative" : "neutral"}>
                    {l.direction === "works" ? "効いた" : l.direction === "fails" ? "効かなかった" : "未確定"}
                  </Badge>
                  <span className="text-xs text-text-subtle">
                    {l.source === "owner" ? "あなたの知見" : `実験から・投稿${l.evidence.posts}本`}・{formatDay(l.createdAt)}
                  </span>
                  <span className="ml-auto">
                    <RetireButton path={`/api/growth/${id}/learnings/${l.id}`} label="もう当てはまらない" confirm="この学びを使わないようにしますか？（履歴には残ります）" />
                  </span>
                </div>
                <p className="font-medium">{l.statement}</p>
                <p className="text-xs text-text-muted">{l.explanation}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-text-muted">あなたがすでに知っていることを加える</p>
          <OwnerLearningForm productId={id} />
        </div>
        {retired.length > 0 && <p className="text-xs text-text-subtle">使わなくなった学び: {retired.length}件</p>}
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

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-text-muted">{title}</p>
      <ul className="mt-1 flex flex-col gap-0.5 text-sm">
        {items.map((item) => (
          <li key={item}>・ {item}</li>
        ))}
      </ul>
    </div>
  );
}
