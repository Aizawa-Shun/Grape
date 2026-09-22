import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ProductOnboarding } from "@/components/features/products/product-onboarding";

export default function NewProductPage() {
  return (
    <div>
      <Link
        href="/products"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        プロダクト一覧へ戻る
      </Link>
      <PageHeader
        title="プロダクトを登録する"
        description="サービスのURLを入力してください。AIがページを読み取り、残りの項目を下書きします。"
      />
      <ProductOnboarding />
    </div>
  );
}
