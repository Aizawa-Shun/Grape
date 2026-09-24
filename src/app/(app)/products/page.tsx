import Link from "next/link";

import { buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Page, PageHeader } from "@/components/ui/page";
import { loadSnapshots } from "@/core/product/next-step";
import { requireUser } from "@/server/auth/current-user";

import { ProductList, listItemsFrom } from "../product-list";

export const dynamic = "force-dynamic";

/**
 * Every service this account has registered.
 *
 * The home page lists them too, but underneath the briefing and as context
 * for it. This is where the list is the point — where the sidebar's
 * "サービス" goes when no service is selected, and where "← 一覧へ戻る" on
 * the registration screen leads back to.
 */
export default async function ProductsPage() {
  const user = await requireUser();
  const snapshots = await loadSnapshots(user.id);

  return (
    <Page>
      <PageHeader
        title="サービス"
        description="登録しているサービスの一覧です。"
        actions={
          <Link href="/products/new" className={buttonClassName("primary", "sm")}>
            サービスを登録する
          </Link>
        }
      />

      {snapshots.length === 0 ? (
        <EmptyState
          title="まだサービスがありません"
          body="URLを入れると、AIがサイトを読んで内容を下書きします。"
        />
      ) : (
        <ProductList products={listItemsFrom(snapshots)} />
      )}
    </Page>
  );
}
