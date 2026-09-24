import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { Callout } from "@/components/ui/callout";
import { Page, PageHeader } from "@/components/ui/page";
import { draftNotesFor, editableValue } from "@/core/context/review";
import { findOwnedProduct } from "@/core/product/ownership";
import { db, schema } from "@/db/client";
import { requireUser } from "@/server/auth/current-user";

import { BackLink } from "../../../back-link";
import { RereadButton } from "../reread-button";
import { SetupProgress } from "../setup-progress";
import { ReviewForm } from "./review-form";

// Watched by SetupProgress while the site is read; a cached render would
// never show the draft arriving.
export const dynamic = "force-dynamic";

/**
 * The second half of registering: confirm what the site turned out to be.
 *
 * Registration lands here (see register-product-form.tsx), and so does the
 * home page's "サービスの説明が合っているか見てください". Three states, all of
 * them read off the row: still reading (progress, which survives a reload),
 * failed with nothing to show (the reason, and a way to try again), or a
 * draft to correct and save.
 */
export default async function ReviewProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const product = await findOwnedProduct(id, (await requireUser()).id);
  if (!product) notFound();

  const versions = await db.query.productContexts.findMany({
    where: eq(schema.productContexts.productId, id),
    orderBy: (contexts, { desc }) => [desc(contexts.version)],
  });
  const latest = versions[0] ?? null;

  const header = (
    <div className="flex flex-col gap-3">
      <BackLink href={latest ? `/products/${id}` : "/products"}>
        {latest ? "サービスのページへ戻る" : "サービス一覧へ戻る"}
      </BackLink>
      <PageHeader
        title={latest ? "登録内容を確認する" : "サービスを登録する"}
        description="AIがページを読み取って下書きした内容を、確認して保存します。"
      />
    </div>
  );

  // Reading (or re-reading after a URL change): whatever draft exists is
  // about to be replaced, so there is nothing yet worth correcting.
  if (product.setupStatus === "pending") {
    return (
      <Page>
        {header}
        <SetupProgress url={product.url} />
      </Page>
    );
  }

  if (!latest) {
    return (
      <Page>
        {header}
        <Callout tone="attention" title="サイトを読み取れませんでした">
          {product.setupError ?? "理由は記録されていません。"}
        </Callout>
        <RereadButton productId={id} />
      </Page>
    );
  }

  const fields = { what: latest.what, who: latest.who, why: latest.why, how: latest.how };
  const notes = draftNotesFor(fields, latest.analysis ?? null, latest.editedByHuman);

  return (
    <Page>
      {header}

      {/* A re-read that failed keeps the previous draft; say so above it. */}
      {product.setupStatus === "failed" && product.setupError && (
        <Callout tone="attention">
          {product.setupError}
          <br />
          下の内容は前回読み取ったものです。
        </Callout>
      )}

      <ReviewForm
        productId={id}
        initialName={product.name}
        initialUrl={product.url}
        initialFields={{
          what: editableValue(fields.what),
          who: editableValue(fields.who),
          why: editableValue(fields.why),
          how: editableValue(fields.how),
        }}
        notes={notes}
      />
    </Page>
  );
}
