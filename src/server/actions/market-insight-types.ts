import type { MarketInsightInput } from "@/lib/validation/market-insight";

export interface InsightActionState {
  status: "idle" | "error" | "success";
  errors?: Partial<Record<keyof MarketInsightInput, string[]>>;
  message?: string;
}

export const initialInsightActionState: InsightActionState = { status: "idle" };

export interface ResearchActionState {
  status: "idle" | "error" | "success";
  message?: string;
  /** Web検索が行われなかった場合など、結果の信頼度に関わる注意書き。 */
  warning?: string;
}

export const initialResearchActionState: ResearchActionState = { status: "idle" };
