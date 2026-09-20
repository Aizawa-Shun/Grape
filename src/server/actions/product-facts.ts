"use server";

import { revalidatePath } from "next/cache";
import { getProductById } from "@/server/firebase/products";
import {
  confirmProductFact,
  deleteAiFacts,
  deleteProductFact,
  insertProductFact,
  recordAnalysisRun,
  updateProductFact,
} from "@/server/firebase/product-facts";
import { parseProductFactInput } from "@/lib/validation/product-fact";
import { analyzeProduct } from "@/server/ai/product-analysis";
import { describeAiError } from "@/server/ai/client";
import type {
  AnalysisActionState,
  FactActionState,
} from "@/server/actions/product-fact-types";

function toRecord(formData: FormData): Record<string, unknown> {
  return Object.fromEntries(formData.entries());
}

/**
 * プロダクトをAIに分析させ、結果をFactとして保存する。
 *
 * 成否にかかわらず実行履歴を残す(マスタープロンプト§6「AIが実行したことと、
 * 実行していないことを明確に区別する」)。失敗時はFactを一切書き換えない。
 */
export async function runProductAnalysis(
  productId: string,
  _prevState: AnalysisActionState,
  _formData: FormData
): Promise<AnalysisActionState> {
  const startedAt = new Date();

  const product = await getProductById(productId);
  if (!product) {
    return { status: "error", message: "プロダクトが見つかりませんでした。" };
  }

  try {
    const result = await analyzeProduct(product);

    // 成功したときだけ、前回のAI結果を置き換える(手動で追加したFactは残す)。
    await deleteAiFacts(productId);
    for (const fact of result.facts) {
      await insertProductFact(
        productId,
        {
          category: fact.category,
          content: fact.content,
          recordType: fact.recordType,
          source: "ai",
          evidence: fact.evidence,
          sourceUrl: result.fetchedPage ? result.sourceUrl : undefined,
        }
      );
    }

    await recordAnalysisRun(productId, {
      status: "succeeded",
      model: result.model,
      sourceUrl: result.sourceUrl,
      fetchedPage: result.fetchedPage,
      factCount: result.facts.length,
      startedAt,
      finishedAt: new Date(),
    });

    revalidatePath(`/products/${productId}`);
    return {
      status: "success",
      message: `${result.facts.length}件の項目を整理しました。`,
      warning: result.fetchedPage
        ? undefined
        : `サイトの内容を取得できなかったため、登録内容のみから分析しました(${result.fetchError})。`,
    };
  } catch (error) {
    const message = describeAiError(error);
    await recordAnalysisRun(productId, {
      status: "failed",
      error: message,
      sourceUrl: product.url,
      fetchedPage: false,
      factCount: 0,
      startedAt,
      finishedAt: new Date(),
    });
    revalidatePath(`/products/${productId}`);
    return { status: "error", message };
  }
}

/** 利用者が自分でFactを追加する(AIを使わずに使える経路)。 */
export async function addProductFact(
  productId: string,
  _prevState: FactActionState,
  formData: FormData
): Promise<FactActionState> {
  const parsed = parseProductFactInput(toRecord(formData));
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      message: "入力内容を確認してください。",
    };
  }

  await insertProductFact(productId, { ...parsed.data, source: "user" });
  revalidatePath(`/products/${productId}`);
  return { status: "success", message: "追加しました。" };
}

/** AIの出力を利用者が修正する。修正した時点で確認済みになる。 */
export async function editProductFact(
  productId: string,
  factId: string,
  _prevState: FactActionState,
  formData: FormData
): Promise<FactActionState> {
  const parsed = parseProductFactInput(toRecord(formData));
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      message: "入力内容を確認してください。",
    };
  }

  const { changes } = await updateProductFact(productId, factId, parsed.data);
  if (changes === 0) {
    return { status: "error", message: "対象が見つかりませんでした。" };
  }

  revalidatePath(`/products/${productId}`);
  return { status: "success", message: "保存しました。" };
}

/** AIの出力内容を「これで合っている」と承認する。 */
export async function confirmFact(productId: string, factId: string): Promise<void> {
  await confirmProductFact(productId, factId);
  revalidatePath(`/products/${productId}`);
}

/** 誤っている項目を削除する。 */
export async function removeFact(productId: string, factId: string): Promise<void> {
  await deleteProductFact(productId, factId);
  revalidatePath(`/products/${productId}`);
}
