import { tryParseStructured } from "./json-schema";
import { LLMError, type CompletionRequest, type CompletionResult, type StructuredCompletionRequest, type Usage } from "./types";

/**
 * One retry when a model's output does not parse.
 *
 * This exists for the small local models Grape is expected to run on: one
 * stray token from a 1.5B model used to kill the whole diagnose → recommend
 * chain, and the person saw a 502 with a fragment of that output in it.
 *
 * Only applied to the adapters that parse text. Anthropic constrains decoding
 * server-side and its rare failure is a refusal, which re-asking does not fix.
 */

const MAX_ECHOED_OUTPUT = 500;

type Chat = (
  req: CompletionRequest,
  format?: unknown,
) => Promise<{ text: string; usage: Usage; model: string }>;

export interface RepairOptions {
  provider: string;
  /** Total attempts, including the first. 1 disables repair entirely. */
  maxAttempts: number;
  format?: unknown;
}

export async function completeStructuredWithRepair<T>(
  chat: Chat,
  req: StructuredCompletionRequest<T>,
  options: RepairOptions,
): Promise<CompletionResult<T>> {
  let lastRaw = "";
  let lastReason = "";

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    const user = attempt === 1 ? req.user : req.user + repairInstruction(lastRaw, lastReason);
    const { text, usage, model } = await chat({ ...req, user }, options.format);

    const outcome = tryParseStructured(text, req.schema);
    if (outcome.ok) return { value: outcome.value, usage, model };

    lastRaw = text;
    lastReason = outcome.reason;
  }

  throw new LLMError(
    `Model output for "${req.schemaName}" was unusable after ${options.maxAttempts} attempt(s) ` +
      `(${lastReason}): ${lastRaw.slice(0, 300)}`,
    options.provider,
    "bad_output",
  );
}

/**
 * Appended to the *user* message, never the system one: the system block holds
 * the Product Context snapshot that Anthropic prefix-caching keys on, and
 * editing it would throw that cache away on every retry.
 */
function repairInstruction(raw: string, reason: string): string {
  return [
    "",
    "",
    "# 前回の出力は形式が不正でした",
    `理由: ${reason}`,
    "",
    "前回の出力:",
    raw.slice(0, MAX_ECHOED_OUTPUT),
    "",
    "JSONオブジェクトだけを出力してください。説明文・コードフェンス・前置き・後置きは一切書かないでください。",
  ].join("\n");
}
