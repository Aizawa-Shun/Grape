"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { insertProduct, updateProductRecord } from "@/server/firebase/products";
import { parseProductInput } from "@/lib/validation/product";
import type { ProductActionState } from "@/server/actions/product-types";

function toRecord(formData: FormData): Record<string, unknown> {
  return Object.fromEntries(formData.entries());
}

/**
 * 新規プロダクトを作成する。成功時は詳細画面へリダイレクトする
 * (リダイレクト自体が保存成功のフィードバックを兼ねる)。
 */
export async function createProduct(
  _prevState: ProductActionState,
  formData: FormData
): Promise<ProductActionState> {
  const parsed = parseProductInput(toRecord(formData));
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      message: "入力内容を確認してください。",
    };
  }

  let id: string;
  try {
    const created = await insertProduct(parsed.data);
    id = created.id;
  } catch {
    return { status: "error", message: "保存に失敗しました。時間を置いて再度お試しください。" };
  }

  revalidatePath("/products");
  revalidatePath("/overview");
  redirect(`/products/${id}`);
}

/**
 * 既存プロダクトを更新する。
 * 呼び出し側で `updateProduct.bind(null, id)` として id を固定して使う。
 */
export async function updateProduct(
  id: string,
  _prevState: ProductActionState,
  formData: FormData
): Promise<ProductActionState> {
  const parsed = parseProductInput(toRecord(formData));
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      message: "入力内容を確認してください。",
    };
  }

  try {
    const { changes } = await updateProductRecord(id, parsed.data);
    if (changes === 0) {
      return { status: "error", message: "対象のプロダクトが見つかりませんでした。" };
    }
  } catch {
    return { status: "error", message: "保存に失敗しました。時間を置いて再度お試しください。" };
  }

  revalidatePath(`/products/${id}`);
  revalidatePath("/products");
  revalidatePath("/overview");
  return { status: "success", message: "保存しました。" };
}
