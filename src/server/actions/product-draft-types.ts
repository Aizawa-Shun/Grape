import type { ProductDraft } from "@/server/ai/product-draft";

export interface DraftActionState {
  status: "idle" | "error" | "success";
  /** 成功時の下書き。利用者が確認・修正してから登録する。 */
  draft?: ProductDraft;
  /** 正規化後のURL。 */
  url?: string;
  message?: string;
}

export const initialDraftActionState: DraftActionState = { status: "idle" };
