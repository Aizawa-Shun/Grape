import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ProductDetail } from "@/components/features/products/product-detail";
import { ProductIntelligence } from "@/components/features/products/product-intelligence";
import { getProductById } from "@/server/firebase/products";
import { getLatestAnalysisRun, listProductFacts } from "@/server/firebase/product-facts";

// DBの内容は実行時に変わるため、ビルド時に静的化せず常に動的にレンダリングする。
export const dynamic = "force-dynamic";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getProductById(id);

  if (!product) {
    notFound();
  }

  const [facts, latestRun] = await Promise.all([
    listProductFacts(id),
    getLatestAnalysisRun(id),
  ]);

  return (
    <div>
      <Link
        href="/products"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        プロダクト一覧へ戻る
      </Link>
      <PageHeader title={product.name} description="登録されているプロダクト情報です。" />
      <div className="flex flex-col gap-8">
        <ProductDetail product={product} />
        <ProductIntelligence productId={product.id} facts={facts} latestRun={latestRun} />
      </div>
    </div>
  );
}
