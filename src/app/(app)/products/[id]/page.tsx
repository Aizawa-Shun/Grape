import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { ContextEditor } from "./context-editor";

import { db, schema } from "@/db/client";

/**
 * The ground everything else stands on.
 *
 * Not a switcher — the sidebar does that — but the place to check what Grape
 * believes this service is. Every diagnosis and every generated sentence is
 * reasoned from these four answers, so when the advice feels wrong, this is
 * the first page to open.
 */
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{product.name}</h1>
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
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-text-muted">このサービスについて</h2>
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
        <h2 className="text-sm font-medium text-text-muted">読み取ったページ（{pages.length}）</h2>
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
  );
}
