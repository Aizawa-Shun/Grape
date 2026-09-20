import Link from "next/link";
import { Compass } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { MarketIntelligence } from "@/components/features/market/market-intelligence";
import { listProducts } from "@/server/firebase/products";
import { getLatestResearchRun, listMarketInsights } from "@/server/firebase/market-insights";

// DBの内容は実行時に変わるため、ビルド時に静的化せず常に動的にレンダリングする。
export const dynamic = "force-dynamic";

export default async function MarketPage() {
  const products = await listProducts();
  const product = products[0];

  if (!product) {
    return (
      <div>
        <PageHeader
          title="市場"
          description="ターゲット顧客・顧客課題・競合や代替手段・顧客が情報を探す場所についての調査結果を整理します。"
        />
        <EmptyState
          icon={Compass}
          title="市場インテリジェンスはまだありません"
          description="市場調査はプロダクト登録後に開始できます。まずはプロダクトを登録してください。"
          action={
            <Button asChild variant="outline">
              <Link href="/products">プロダクトを登録する</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const [insights, latestRun] = await Promise.all([
    listMarketInsights(product.id),
    getLatestResearchRun(product.id),
  ]);

  return (
    <div>
      <PageHeader
        title="市場"
        description="ターゲット顧客・顧客課題・競合や代替手段・顧客が情報を探す場所についての調査結果を整理します。"
      />
      <MarketIntelligence
        productId={product.id}
        productName={product.name}
        insights={insights}
        latestRun={latestRun}
      />
    </div>
  );
}
