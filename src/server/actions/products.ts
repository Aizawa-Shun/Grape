"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { insertProduct, updateProductRecord } from "@/server/firebase/products";
import { parseProductInput } from "@/lib/validation/product";
import { draftProductFromUrl } from "@/server/ai/product-draft";
import { describeAiError } from "@/server/ai/client";
import { PageFetchError } from "@/server/ai/fetch-page";
import type { ProductActionState } from "@/server/actions/product-types";
import type { DraftActionState } from "@/server/actions/product-draft-types";

function toRecord(formData: FormData): Record<string, unknown> {
  return Object.fromEntries(formData.entries());
}

/**
 * URLからフォームの下書きをAIに作らせる。
 *
 * 失敗しても登録自体は手動で続けられるよう、エラーは理由付きで返すだけにして
 * 画面遷移は行わない。
 */
export async function draftProduct(
  _prevState: DraftActionState,
  formData: FormData
): Promise<DraftActionState> {
  const url = String(formData.get("url") ?? "").trim();
  if (!url) {
    return { status: "error", message: "URLを入力してください。" };
  }

  try {
    const result = await draftProductFromUrl(url);
    return { status: "success", draft: result.draft, url: result.url };
  } catch (error) {
    // ページ取得の失敗はAIのエラーと原因が違うため、文言を分ける。
    const message =
      error instanceof PageFetchError
        ? `ページを読み取れませんでした(${error.message})。手動で入力してください。`
        : describeAiError(error);
    return { status: "error", message };
  }
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
