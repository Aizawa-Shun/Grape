import type { ProductFactInput } from "@/lib/validation/product-fact";

export interface FactActionState {
  status: "idle" | "error" | "success";
  errors?: Partial<Record<keyof ProductFactInput, string[]>>;
  message?: string;
}

export const initialFactActionState: FactActionState = { status: "idle" };

export interface AnalysisActionState {
  status: "idle" | "error" | "success";
  message?: string;
  /** ページ取得に失敗したが分析自体は完了した場合の注意書き。 */
  warning?: string;
}

export const initialAnalysisActionState: AnalysisActionState = { status: "idle" };
