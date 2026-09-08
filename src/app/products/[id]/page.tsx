import { eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { estimateActionCostUsd } from "@/core/action/channel";
import { getFunnel } from "@/core/data/funnel";
import { db, schema } from "@/db/client";
import { env } from "@/env";

import { ContextEditor } from "./context-editor";
import { DiagnosisPanel } from "./diagnosis-panel";
import { FunnelView } from "./funnel-view";
import { KeyEventForm } from "./key-event-form";
import { TrackingSnippet } from "./tracking-snippet";

const WINDOW_CHOICES = [7, 30, 90] as const;

function parseWindowDays(raw: string | undefined): number {
  const n = Number(raw);
  return (WINDOW_CHOICES as readonly number[]).includes(n) ? n : 30;
}

/**
 * Two halves, deliberately unequal.
 *
 * What to do now — the finding and this week's tasks — and what the numbers
 * say, are what someone opens this page for. Everything else is setup that is
 * done once and then only occasionally revisited, so it collapses into a
 * single line as soon as it is complete instead of competing for attention
 * forever. Previously all six sections sat at the same weight.
 */
export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ windowDays?: string }>;
}) {
  const { id } = await params;
  const { windowDays: windowDaysParam } = await searchParams;
  const windowDays = parseWindowDays(windowDaysParam);

  const product = await db.query.products.findFirst({ where: eq(schema.products.id, id) });
  if (!product) notFound();

  const versions = await db.query.productContexts.findMany({
    where: eq(schema.productContexts.productId, id),
    orderBy: (contexts, { desc }) => [desc(contexts.version)],
  });
  const latest = versions[0] ?? null;

  const pages = await db.query.crawlPages.findMany({
    where: eq(schema.crawlPages.productId, id),
    orderBy: (crawlPages, { desc }) => [desc(crawlPages.fetchedAt)],
  });

  const [events] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.events)
    .where(eq(schema.events.productId, id));
  const eventCount = Number(events?.n ?? 0);

  const funnel = await getFunnel(id, { windowDays });

  const latestDiagnosis =
    (await db.query.diagnoses.findFirst({
      where: eq(schema.diagnoses.productId, id),
      orderBy: (diagnoses, { desc }) => [desc(diagnoses.createdAt)],
    })) ?? null;

  const tasksRaw = latestDiagnosis
    ? await db.query.tasks.findMany({
        where: eq(schema.tasks.diagnosisId, latestDiagnosis.id),
        orderBy: (tasks, { desc }) => [desc(tasks.impact)],
      })
    : [];

  // Each task's latest artifact (if generated) and latest action run (if
  // approved) — fetched per task since a task list this small does not
  // warrant a join, and keeping it as separate queries keeps each one legible.
  const tasks = await Promise.all(
    tasksRaw.map(async (task) => {
      const artifact =
        (await db.query.artifacts.findFirst({
          where: eq(schema.artifacts.taskId, task.id),
          orderBy: (artifacts, { desc }) => [desc(artifacts.createdAt)],
        })) ?? null;
      const actionRun =
        (await db.query.actionRuns.findFirst({
          where: eq(schema.actionRuns.taskId, task.id),
          orderBy: (actionRuns, { desc }) => [desc(actionRuns.createdAt)],
        })) ?? null;
      const costEstimateUsd = artifact
        ? estimateActionCostUsd(task.channel, artifact.content)
        : null;
      const outcome =
        (await db.query.outcomes.findFirst({
          where: eq(schema.outcomes.taskId, task.id),
          orderBy: (outcomes, { desc }) => [desc(outcomes.evaluatedAt)],
        })) ?? null;
      return { ...task, artifact, actionRun, costEstimateUsd, outcome };
    }),
  );

  // The same three conditions next-step.ts uses, so the page and the
  // dashboard cannot disagree about whether setup is finished.
  const setupSteps = [
    { label: "サービスの説明を確認した", done: latest?.editedByHuman === true },
    { label: "計測用のコードを貼った", done: eventCount > 0 },
    { label: "ゴールの操作を決めた", done: product.keyEventName !== null },
  ];
  const remaining = setupSteps.filter((step) => !step.done).length;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6 sm:py-16">
      <header className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-text-muted hover:text-text">
          ← 一覧にもどる
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
        <a
          href={product.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-text-muted hover:underline"
        >
          {product.url}
        </a>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-text-muted">いまの状態とやること</h2>
        <DiagnosisPanel
          productId={id}
          diagnosis={latestDiagnosis}
          tasks={tasks}
          dryRun={env.GRAPE_ACTION_DRY_RUN}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-text-muted">利用者の流れ</h2>
        <FunnelView productId={id} funnel={funnel} windowDays={windowDays} />
      </section>

      <details open={remaining > 0} className="rounded-md border border-border">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          設定
          {remaining > 0 ? (
            <Badge tone="attention" className="ml-2">
              あと{remaining}つ
            </Badge>
          ) : (
            <span className="ml-2 text-xs font-normal text-text-muted">ぜんぶ済んでいます</span>
          )}
        </summary>

        <div className="flex flex-col gap-8 border-t border-border px-4 py-5">
          <ul className="flex flex-col gap-1 text-sm">
            {setupSteps.map((step) => (
              <li key={step.label} className={step.done ? "text-text-muted" : ""}>
                <span aria-hidden="true">{step.done ? "✓" : "・"}</span>{" "}
                <span className="sr-only">{step.done ? "完了: " : "未完了: "}</span>
                {step.label}
              </li>
            ))}
          </ul>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">ゴールの操作</h3>
            <KeyEventForm productId={id} keyEventName={product.keyEventName} />
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">計測用のコード</h3>
            <TrackingSnippet productId={id} ingestBaseUrl={env.INGEST_BASE_URL} />
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">このサービスについて</h3>
              {latest && (
                <span className="text-xs text-text-muted">
                  {versions.length}回目の内容
                  {latest.editedByHuman ? "（あなたが修正）" : "（自動で作成）"}
                </span>
              )}
            </div>
            {latest ? (
              <ContextEditor
                productId={id}
                initial={{ what: latest.what, who: latest.who, why: latest.why, how: latest.how }}
                gaps={latest.gaps}
                editedByHuman={latest.editedByHuman}
              />
            ) : (
              <p className="text-sm text-text-muted">まだ内容がありません。</p>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">読み取ったページ（{pages.length}）</h3>
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-sm">
              {pages.map((page) => (
                <li key={page.id} className="flex flex-col gap-1 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{page.url}</span>
                    <span
                      className={
                        page.status === 200
                          ? "shrink-0 text-xs text-text-muted"
                          : "shrink-0 text-xs text-negative"
                      }
                    >
                      {page.status === 200 ? "読めました" : "読めませんでした"}
                    </span>
                  </div>
                  {page.renderedWith === "browser" && (
                    // Worth stating in full rather than hiding in a tooltip:
                    // anything that reads this page without running scripts —
                    // search engines, link previews — sees nothing at all.
                    <p className="text-xs text-attention">
                      このページはJavaScriptが動かないと中身が出ません。検索エンジンやSNSのリンクからは空に見えている可能性があります。
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </details>
    </div>
  );
}
