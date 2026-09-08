import { ZodError } from "zod";

import { ChannelError } from "./action/channel";
import { LLMError } from "./llm/types";

/**
 * One vocabulary for everything that can go wrong, so the HTTP boundary can
 * decide a status and a sentence from the code alone.
 *
 * What is deliberately *not* here: the text shown to a person. That lives at
 * the boundary (src/server/http/errors.ts) and is looked up by code. Keeping
 * it out of the core means product copy never drifts into modules that are
 * meant to be pure, and — more importantly — it makes it structurally
 * impossible for a raw model output or a driver message to reach the browser,
 * because the catalog never sees `error.message`.
 */

export const ERROR_CODES = [
  "INVALID_INPUT",
  "NOT_FOUND",
  "CONFLICT",
  "TOO_EARLY",
  "NOT_ENOUGH_DATA",
  "RATE_LIMITED",
  "UNAUTHORIZED",

  "CRAWL_UNREACHABLE",
  "CRAWL_EMPTY",
  "CRAWL_BLOCKED_TARGET",

  "LLM_UNREACHABLE",
  "LLM_TIMEOUT",
  "LLM_AUTH",
  "LLM_RATE_LIMITED",
  "LLM_BAD_OUTPUT",
  "LLM_REFUSED",

  "CHANNEL_AUTH",
  "CHANNEL_FAILED",

  "DB_ERROR",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppErrorOptions {
  /**
   * A short, safe fragment appended to the catalog sentence — a stage name, a
   * page count, a number of days. Must be produced by Grape's own code: never
   * model output, never a driver message.
   */
  hint?: string;
  cause?: unknown;
}

export class AppError extends Error {
  readonly hint?: string;

  constructor(
    readonly code: ErrorCode,
    /** Technical detail, for the log only. Never shown to a person. */
    message: string,
    options: AppErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.hint = options.hint;
  }
}

const LLM_FAILURE_CODES = {
  unreachable: "LLM_UNREACHABLE",
  timeout: "LLM_TIMEOUT",
  auth: "LLM_AUTH",
  rate_limited: "LLM_RATE_LIMITED",
  bad_output: "LLM_BAD_OUTPUT",
  refused: "LLM_REFUSED",
  server_error: "LLM_UNREACHABLE",
} as const;

const CHANNEL_FAILURE_CODES = {
  auth: "CHANNEL_AUTH",
  rejected: "CHANNEL_FAILED",
  network: "CHANNEL_FAILED",
} as const;

/** Drizzle wraps driver failures with this prefix and no type to switch on. */
const DRIZZLE_QUERY_PREFIX = "Failed query:";

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof LLMError) {
    return new AppError(LLM_FAILURE_CODES[error.failure], error.message, { cause: error });
  }

  if (error instanceof ChannelError) {
    return new AppError(CHANNEL_FAILURE_CODES[error.failure], error.message, { cause: error });
  }

  if (error instanceof ZodError) {
    const detail = error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return new AppError("INVALID_INPUT", detail, { cause: error });
  }

  if (error instanceof Error && error.message.startsWith(DRIZZLE_QUERY_PREFIX)) {
    return new AppError("DB_ERROR", error.message, { cause: error });
  }

  return new AppError("INTERNAL", error instanceof Error ? error.message : String(error), {
    cause: error,
  });
}
