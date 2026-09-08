import type { ZodType } from "zod";

/**
 * The Intelligence layer's contract with the outside world.
 *
 * Grape's asset is the Context, the Data and the Decision Engine — not the
 * model behind them (spec §7). Everything above this interface is written
 * against `LLMProvider`, so switching Claude for a local model is an env
 * change. Anything a single vendor can do but the others cannot stays out of
 * this interface on purpose.
 */

export const TASK_KINDS = ["extract", "diagnose", "generate"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export type Effort = "low" | "medium" | "high";

/**
 * Diagnosis is the one call where being wrong is expensive: every task,
 * artifact and action downstream is built on its conclusion. Extraction and
 * generation are comparatively forgiving and a human reviews both.
 */
export const EFFORT_BY_KIND: Record<TaskKind, Effort> = {
  extract: "medium",
  diagnose: "high",
  generate: "medium",
};

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export const EMPTY_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

export interface CompletionRequest {
  kind: TaskKind;
  /**
   * Stable prefix. The Product Context snapshot belongs here — it is identical
   * across a week of diagnoses, so providers that support prefix caching can
   * serve it from cache. Never put timestamps or per-run ids in here.
   */
  system: string;
  /** Volatile per-call content: this window's metrics, page text, the question. */
  user: string;
  maxTokens?: number;
}

export interface StructuredCompletionRequest<T> extends CompletionRequest {
  schema: ZodType<T>;
  /** Names the output shape for providers that require one. */
  schemaName: string;
}

export interface CompletionResult<T> {
  value: T;
  usage: Usage;
  model: string;
}

export interface ProviderHealth {
  ok: boolean;
  provider: string;
  model: string;
  detail: string;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  completeText(req: CompletionRequest): Promise<CompletionResult<string>>;
  completeStructured<T>(req: StructuredCompletionRequest<T>): Promise<CompletionResult<T>>;
  health(): Promise<ProviderHealth>;
}

/** Raised when a provider answers but the answer is unusable. */
export class LLMError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LLMError";
  }
}
