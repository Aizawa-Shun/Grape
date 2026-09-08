import { notFound } from "next/navigation";

import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";

import { estimateActionCostUsd } from "@/core/action/channel";
import { getFunnel } from "@/core/data/funnel";
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

  const product = await db.query.products.findFirst({
    where: eq(schema.products.id, id),
  });
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
      const costEstimateUsd = artifact ? estimateActionCostUsd(task.channel, artifact.content) : null;
      const outcome =
        (await db.query.outcomes.findFirst({
          where: eq(schema.outcomes.taskId, task.id),
          orderBy: (outcomes, { desc }) => [desc(outcomes.evaluatedAt)],
        })) ?? null;
      return { ...task, artifact, actionRun, costEstimateUsd, outcome };
    }),
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-1">
        <a href="/" className="text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
          ← ダッシュボード
        </a>
        <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
        <a
          href={product.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-zinc-500 hover:underline"
        >
          {product.url}
        </a>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-zinc-500">今週のボトルネックとタスク</h2>
        <DiagnosisPanel productId={id} diagnosis={latestDiagnosis} tasks={tasks} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-zinc-500">Product Context</h2>
          {latest && <span className="text-xs text-zinc-400">version {latest.version}</span>}
        </div>

        {latest ? (
          <ContextEditor
            productId={id}
            initial={{ what: latest.what, who: latest.who, why: latest.why, how: latest.how }}
            gaps={latest.gaps}
            editedByHuman={latest.editedByHuman}
          />
        ) : (
          <p className="text-sm text-zinc-400">まだContextがありません。</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-zinc-500">ファネル</h2>
        <KeyEventForm productId={id} keyEventName={product.keyEventName} />
        <FunnelView productId={id} funnel={funnel} windowDays={windowDays} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-zinc-500">トラッキングスニペット</h2>
        <TrackingSnippet productId={id} ingestBaseUrl={env.INGEST_BASE_URL} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-zinc-500">クロールしたページ ({pages.length})</h2>
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
          {pages.map((page) => (
            <li key={page.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="truncate">{page.url}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs">
                {page.renderedWith === "browser" && (
                  // Worth surfacing, not hiding: anything that reads this page
                  // without running scripts — search engines, link previews —
                  // sees nothing.
                  <span
                    className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-950 dark:text-amber-500"
                    title="サーバーが返すHTMLは空で、JavaScript実行後にのみ本文が現れます。検索エンジンやリンクプレビューからは読めません。"
                  >
                    JS描画
                  </span>
                )}
                <span className={page.status === 200 ? "text-zinc-400" : "text-red-500"}>
                  {page.status || "unreachable"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {versions.length > 1 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-zinc-500">履歴</h2>
          <ul className="flex flex-col gap-1 text-sm text-zinc-500">
            {versions.map((version) => (
              <li key={version.id}>
                v{version.version} — {version.editedByHuman ? "人間が修正" : "自動抽出"} —{" "}
                {version.createdAt.toLocaleString("ja-JP")}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
