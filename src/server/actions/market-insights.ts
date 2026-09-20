"use server";

import { revalidatePath } from "next/cache";
import { getProductById } from "@/server/firebase/products";
import { listProductFacts } from "@/server/firebase/product-facts";
import {
  confirmMarketInsight,
  deleteMarketInsight,
  deleteUnconfirmedAiInsights,
  insertMarketInsight,
  recordResearchRun,
  updateMarketInsight,
} from "@/server/firebase/market-insights";
import { parseMarketInsightInput } from "@/lib/validation/market-insight";
import { researchMarket } from "@/server/ai/market-research";
import { describeAiError } from "@/server/ai/client";
import type {
  InsightActionState,
  ResearchActionState,
} from "@/server/actions/market-insight-types";

function toRecord(formData: FormData): Record<string, unknown> {
  return Object.fromEntries(formData.entries());
}

/**
 * Web検索を使って市場を調査し、結果を保存する。
 *
 * 成否にかかわらず実行履歴を残す。失敗時は既存の内容を一切書き換えない。
 */
export async function runMarketResearch(
  productId: string,
  _prevState: ResearchActionState,
  _formData: FormData
): Promise<ResearchActionState> {
  const startedAt = new Date();

  const product = await getProductById(productId);
  if (!product) {
    return { status: "error", message: "プロダクトが見つかりませんでした。" };
  }

  try {
    const facts = await listProductFacts(productId);
    const result = await researchMarket(product, facts);

    // 成功時のみ、未確認のAI生成分を置き換える(確認済みと手動入力は残す)。
    await deleteUnconfirmedAiInsights(productId);
    const capturedAt = new Date();
    for (const insight of result.insights) {
      await insertMarketInsight(productId, {
        category: insight.category,
        content: insight.content,
        recordType: insight.recordType,
        sourceUrl: insight.sourceUrl || undefined,
        sourceTitle: insight.sourceTitle || undefined,
        source: "ai",
        evidence: insight.evidence,
        capturedAt,
      });
    }

    await recordResearchRun(productId, {
      status: "succeeded",
      model: result.model,
      searchCount: result.searchCount,
      insightCount: result.insights.length,
      startedAt,
      finishedAt: new Date(),
    });

    revalidatePath("/market");
    return {
      status: "success",
      message: `${result.insights.length}件の市場情報を整理しました。`,
      warning:
        result.searchCount === 0
          ? "Web検索が実行されなかったため、外部情報による裏付けがありません。内容は推測として扱ってください。"
          : undefined,
    };
  } catch (error) {
    const message = describeAiError(error);
    await recordResearchRun(productId, {
      status: "failed",
      error: message,
      searchCount: 0,
      insightCount: 0,
      startedAt,
      finishedAt: new Date(),
    });
    revalidatePath("/market");
    return { status: "error", message };
  }
}

/** 利用者が自分で市場情報を追加する。 */
export async function addMarketInsight(
  productId: string,
  _prevState: InsightActionState,
  formData: FormData
): Promise<InsightActionState> {
  const parsed = parseMarketInsightInput(toRecord(formData));
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      message: "入力内容を確認してください。",
    };
  }

  await insertMarketInsight(productId, { ...parsed.data, source: "user" });
  revalidatePath("/market");
  return { status: "success", message: "追加しました。" };
}

/** AIの調査結果を利用者が修正する。 */
export async function editMarketInsight(
  productId: string,
  insightId: string,
  _prevState: InsightActionState,
  formData: FormData
): Promise<InsightActionState> {
  const parsed = parseMarketInsightInput(toRecord(formData));
  if (!parsed.success) {
    return {
      status: "error",
      errors: parsed.error.flatten().fieldErrors,
      message: "入力内容を確認してください。",
    };
  }

  const { changes } = await updateMarketInsight(productId, insightId, parsed.data);
  if (changes === 0) {
    return { status: "error", message: "対象が見つかりませんでした。" };
  }

  revalidatePath("/market");
  return { status: "success", message: "保存しました。" };
}

/** 調査結果を「これで合っている」と承認する。 */
export async function confirmInsight(productId: string, insightId: string): Promise<void> {
  await confirmMarketInsight(productId, insightId);
  revalidatePath("/market");
}

/** 誤っている項目を削除する。 */
export async function removeInsight(productId: string, insightId: string): Promise<void> {
  await deleteMarketInsight(productId, insightId);
  revalidatePath("/market");
}
