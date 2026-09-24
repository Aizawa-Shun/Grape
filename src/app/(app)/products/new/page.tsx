import { Page, PageHeader } from "@/components/ui/page";
import { requireUser } from "@/server/auth/current-user";

import { BackLink } from "../../back-link";
import { RegisterProductForm } from "../../register-product-form";

/**
 * The first half of registering: the address. What the site turns out to be
 * is drafted afterwards and confirmed on /products/[id]/review — this page
 * only has to get a row to exist, because the reading outlives the request
 * that starts it (see api/products/route.ts).
 */
export default async function NewProductPage() {
  await requireUser();

  return (
    <Page>
      <div className="flex flex-col gap-3">
        <BackLink href="/products">サービス一覧へ戻る</BackLink>
        <PageHeader
          title="サービスを登録する"
          description="サービスのURLを入力してください。AIがページを読み取り、残りの項目を下書きします。"
        />
      </div>

      <RegisterProductForm />
    </Page>
  );
}
