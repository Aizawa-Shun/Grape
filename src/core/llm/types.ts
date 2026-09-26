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

/**
 * `research` is the growth loop's reading of the market — web searches, the
 * competitor pages, the conversations found — kept apart from `extract` so
 * /usage shows what that loop costs on its own.
 */
export const TASK_KINDS = ["extract", "diagnose", "generate", "research"] as const;
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
  research: "medium",
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
  /**
   * How hard to think, when the call knows better than its kind: a list of
   * search phrases needs far less than a strategy, though both are "research".
   * Providers without such a control ignore it.
   */
  effort?: Effort;
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
/**
 * What went wrong, in terms a caller can branch on. Every provider has to
 * classify its own failures, because only the adapter knows whether a 401 from
 * its endpoint means a bad key or a bad request — and string-matching the
 * message at the boundary is exactly what this exists to avoid.
 */
export type LLMFailure =
  | "unreachable"
  | "timeout"
  | "auth"
  | "rate_limited"
  /** Reached the model, but its output was not parseable JSON or failed the schema. */
  | "bad_output"
  /** The model declined on policy grounds. Distinct from bad output: retrying is pointless. */
  | "refused"
  | "server_error"
  /** Grape's own spend guard refused the call before it reached the model. */
  | "budget_exceeded"
  /** The provider account itself is out of credit — the owner's to top up, not Grape's to retry. */
  | "billing";

/** Shared by the adapters that only have an HTTP status to go on. */
export function failureForStatus(status: number): LLMFailure {
  if (status === 401 || status === 403) return "auth";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limited";
  return "server_error";
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly failure: LLMFailure,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LLMError";
  }
}
