import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { Page, PageHeader, Section } from "@/components/ui/page";

import { ContextEditor } from "./context-editor";

import { findOwnedProduct } from "@/core/product/ownership";
import { db, schema } from "@/db/client";
import { requireUser } from "@/server/auth/current-user";

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

  // Scoped to the signed-in account, and indistinguishable from a product that
  // does not exist: a separate "not yours" would confirm the id is real.
  const product = await findOwnedProduct(id, (await requireUser()).id);
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
    <Page>
      <PageHeader
        title={product.name}
        description={
          <a
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {product.url}
          </a>
        }
      />

      <Section
        title="このサービスについて"
        actions={
          latest && (
            <span className="text-xs text-text-muted">
              {versions.length}回目の内容
              {latest.editedByHuman ? "（あなたが修正）" : "（自動で作成）"}
            </span>
          )
        }
      >
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
      </Section>

      <Section title={`読み取ったページ（${pages.length}）`}>
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border text-sm shadow-card">
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
      </Section>
    </Page>
  );
}
