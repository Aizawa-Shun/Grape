import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonClassName } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Page, PageHeader, Section } from "@/components/ui/page";

import { AnalysisReport } from "./analysis-report";
import { ContextEditor } from "./context-editor";
import { DeleteProductButton } from "./delete-product-button";
import { RereadButton } from "./reread-button";
import { SetupProgress } from "./setup-progress";

import { findOwnedProduct } from "@/core/product/ownership";
import { contextVersions } from "@/core/context/edit";
import { db } from "@/db/client";
import { by } from "@/db/sort";
import { requireUser } from "@/server/auth/current-user";

// The row changes underneath this page while the crawl runs, and
// SetupProgress refreshes the route to watch it — neither works against a
// cached render.
export const dynamic = "force-dynamic";

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

  const versions = await contextVersions(id);
  const latest = versions[0] ?? null;
  const analyzed = versions.find((version) => version.analysis) ?? null;

  const pages = (await db.crawlPages.find({ where: [["productId", "==", id]] })).sort(
    by((page) => page.fetchedAt, "desc"),
  );

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
        actions={
          <>
            <Link href={`/products/${id}/review`} className={buttonClassName("secondary", "sm")}>
              名前・URL・説明を編集
            </Link>
            <DeleteProductButton productId={id} name={product.name} />
          </>
        }
      />

      {/*
        The failure shown above the context rather than in place of it: a
        re-crawl that failed still leaves the previous, working context below,
        and that context is what every diagnosis is still reasoning from. The
        reader needs both facts — what Grape currently believes, and that the
        latest attempt to update it did not land.
      */}
      {product.setupStatus === "failed" && product.setupError && (
        <Callout tone="attention">
          {/* The stored message is already a full sentence written for the
              reader (see runProductSetup), so it needs no heading above it
              repeating half of itself. */}
          {product.setupError}
          {latest && (
            <>
              <br />
              下の内容は前回読み取ったもので、いまも診断に使われています。
            </>
          )}
        </Callout>
      )}

      {product.setupStatus === "pending" && !latest && (
        <Section title="このサービスについて">
          <SetupProgress productId={product.id} url={product.url} />
        </Section>
      )}

      {product.setupStatus === "pending" && latest && (
        <SetupProgress productId={product.id} url={product.url} compact />
      )}

      {/*
        The analysis is the report whenever one exists — taken from the latest
        version that has one, not only from the latest version. A human
        correction is a new version with no analysis on it (context/edit.ts
        writes the four fields only), and the review screen now asks everyone
        to confirm those fields; tying the report to the latest version would
        have made it vanish the moment anyone did what they were asked.
        The four fields below are what diagnosis actually reasons from.
      */}
      {analyzed?.analysis && latest ? (
        <>
          {latest.editedByHuman && (
            <Callout>
              下の分析は、AIがサイトを読んだ時点のものです。診断と提案には、あなたが確認した「診断に使う内容」が使われます。
            </Callout>
          )}
          <AnalysisReport analysis={analyzed.analysis} />
          <Section
            title={latest.editedByHuman ? "診断に使う内容" : "内容を直す"}
            description={
              latest.editedByHuman
                ? undefined
                : "AIの読み取りが違っていたら、ここで直せます。直した内容が診断と提案に使われます。"
            }
            actions={
              latest.editedByHuman ? (
                <span className="text-xs text-text-muted">{versions.length}回目の内容（あなたが確認）</span>
              ) : undefined
            }
          >
            <ContextEditor
              productId={id}
              initial={{ what: latest.what, who: latest.who, why: latest.why, how: latest.how }}
              editedByHuman={latest.editedByHuman}
              quiet={!latest.editedByHuman}
            />
          </Section>
        </>
      ) : latest ? (
        <Section
          title="このサービスについて"
          actions={
            <span className="text-xs text-text-muted">
              {versions.length}回目の内容
              {latest.editedByHuman ? "（あなたが修正）" : "（自動で作成）"}
            </span>
          }
        >
          <ContextEditor
            productId={id}
            initial={{ what: latest.what, who: latest.who, why: latest.why, how: latest.how }}
            editedByHuman={latest.editedByHuman}
          />
        </Section>
      ) : product.setupStatus === "pending" ? null : (
        // The dead end this used to be: a first read that failed left only a
        // delete button. Reading again is the obvious thing to try first.
        <Section title="このサービスについて">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">まだ内容がありません。</p>
            <RereadButton productId={id} />
          </div>
        </Section>
      )}

      {/* Nothing to list until the crawl has written its first page, and an
          empty "読み取ったページ（0）" during setup reads as a result. */}
      {pages.length === 0 && product.setupStatus === "pending" ? null : (
      <Section title={`読み取ったページ（${pages.length}）`}>
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border text-sm shadow-card">
          {pages.map((page) => (
            <li key={page.id} className="flex flex-col gap-1 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 flex-col">
                  {page.title && <span className="truncate font-medium">{page.title}</span>}
                  <span className="truncate text-xs text-text-muted">{page.url}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className={page.status === 200 ? "text-xs text-text-muted" : "text-xs text-negative"}>
                    {page.status === 200 ? "読めました" : "読めませんでした"}
                  </span>
                  <time dateTime={page.fetchedAt.toISOString()} className="text-xs text-text-subtle">
                    {page.fetchedAt.toLocaleString("ja-JP", {
                      // Fixed to Asia/Tokyo rather than the server's zone: this
                      // renders on the server, so "local time" would be the
                      // deployment's, not the reader's.
                      timeZone: "Asia/Tokyo",
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
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
      )}
    </Page>
  );
}
