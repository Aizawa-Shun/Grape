import Link from "next/link";
import { Grape, ArrowUpRight, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { listProducts } from "@/server/firebase/products";

// DBの内容は実行時に変わるため、ビルド時に静的化せず常に動的にレンダリングする。
export const dynamic = "force-dynamic";

/**
 * Overview: ユーザーが最初に開くホーム画面。
 *
 * 目的: 「今何をすべきか」を一目で伝える。
 *
 * - プロダクト未登録: 唯一の次の行動である「プロダクト登録」へ導く。
 * - プロダクト登録済み(Phase 2時点): 登録済みプロダクトを確認できるようにする。
 *   Growth Focus・進行中の実験・承認待ち等のダッシュボード統合はPhase 10で行う
 *   (Market/Opportunities/Experiments等の実データが揃うまでは表示しない)。
 */
export default async function OverviewPage() {
  const registeredProducts = await listProducts();

  if (registeredProducts.length === 0) {
    return (
      <div>
        <PageHeader
          title="概要"
          description="あなたのサービスの状況と、次にやるべきことがここに表示されます。"
        />
        <EmptyState
          icon={Grape}
          title="プロダクトを登録して始めましょう"
          description="Grapeはあなたのサービスと市場を理解し、成長の機会を見つけ、実験を通じて認知拡大・利用者獲得を後押しします。まずはプロダクトを1つ登録してください。"
          action={
            <Button asChild>
              <Link href="/products">プロダクトを登録する</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="概要"
        description="あなたのサービスの状況と、次にやるべきことがここに表示されます。"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/products/new">
              <Plus />
              プロダクトを追加
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">登録済みのプロダクト</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {registeredProducts.map((product) => (
            <Link key={product.id} href={`/products/${product.id}`}>
              <Card className="h-full transition-colors hover:border-primary/40 hover:bg-secondary/30">
                <CardHeader>
                  <CardTitle>{product.name}</CardTitle>
                  <CardDescription className="truncate">{product.url}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>

        <Card className="mt-4 border-dashed bg-transparent">
          <CardContent className="flex flex-col items-start gap-2 py-5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>
              市場調査・成長機会の発見・実験の実行は、次のフェーズで順次有効になります。
            </p>
            <Link
              href="/products"
              className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
            >
              プロダクト一覧を見る
              <ArrowUpRight className="size-3.5" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
