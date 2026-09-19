"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductForm } from "@/components/features/products/product-form";
import { updateProduct } from "@/server/actions/products";
import type { Product } from "@/server/firebase/products";

const FIELDS: { key: keyof Product; label: string }[] = [
  { key: "url", label: "URL" },
  { key: "description", label: "サービス概要" },
  { key: "targetCustomer", label: "想定顧客" },
  { key: "problem", label: "解決する課題" },
];

export function ProductDetail({ product }: { product: Product }) {
  const [editing, setEditing] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const router = useRouter();
  const boundUpdate = updateProduct.bind(null, product.id);

  if (editing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>プロダクト情報を編集</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-xl">
            <ProductForm
              action={boundUpdate}
              product={product}
              submitLabel="保存する"
              onCancel={() => setEditing(false)}
              onSuccess={() => {
                setEditing(false);
                setSavedMessage("保存しました。");
                router.refresh();
              }}
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {savedMessage ? (
        <p
          role="status"
          className="rounded-md bg-success/10 px-3 py-2 text-sm text-success"
        >
          {savedMessage}
        </p>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">{product.name}</CardTitle>
            <a
              href={product.url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm text-primary hover:underline"
            >
              {product.url}
            </a>
          </div>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil />
            編集
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {FIELDS.filter((f) => f.key !== "url").map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {String(product[field.key])}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
