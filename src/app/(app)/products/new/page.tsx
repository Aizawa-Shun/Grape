import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ProductForm } from "@/components/features/products/product-form";
import { createProduct } from "@/server/actions/products";

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
        description="あなたのWebアプリの基本情報を登録してください。この情報をもとにGrapeがサービスを理解します。"
      />
      <div className="max-w-xl">
        <ProductForm action={createProduct} submitLabel="登録する" />
      </div>
    </div>
  );
}
