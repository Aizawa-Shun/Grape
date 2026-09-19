import Link from "next/link";
import { Package, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { listProducts } from "@/server/firebase/products";

// DBの内容は実行時に変わるため、ビルド時に静的化せず常に動的にレンダリングする。
export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const registeredProducts = await listProducts();

  return (
    <div>
      <PageHeader
        title="プロダクト"
        description="URL・サービス概要・想定顧客・解決する課題を登録すると、Grapeがあなたのサービスを理解し始めます。"
        actions={
          registeredProducts.length > 0 ? (
            <Button asChild>
              <Link href="/products/new">
                <Plus />
                新規登録
              </Link>
            </Button>
          ) : undefined
        }
      />

      {registeredProducts.length === 0 ? (
        <EmptyState
          icon={Package}
          title="登録されたプロダクトはまだありません"
          description="まずは1つ、あなたのWebアプリを登録してみましょう。"
          action={
            <Button asChild>
              <Link href="/products/new">
                <Plus />
                プロダクトを登録する
              </Link>
            </Button>
          }
        />
      ) : (
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
      )}
    </div>
  );
}
