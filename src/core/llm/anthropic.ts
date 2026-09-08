import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { env } from "@/env";

import {
  EFFORT_BY_KIND,
  LLMError,
  type CompletionRequest,
  type CompletionResult,
  type LLMFailure,
  type LLMProvider,
  type ProviderHealth,
  type StructuredCompletionRequest,
  type Usage,
} from "./types";

const DEFAULT_MAX_TOKENS = 16_000;

/**
 * Server-side refusal fallback. If a request is declined on policy grounds the
 * API re-runs it on a fallback model inside the same call instead of returning
 * nothing. `"default"` routes by refusal category so there is no model list to
 * maintain. Requires the beta messages endpoint.
 */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

type AnthropicUsageLike = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

function toUsage(usage: AnthropicUsageLike | undefined): Usage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? 0,
  };
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly model: string;
  readonly #client: Anthropic;

  constructor(options: { model: string; apiKey?: string; timeoutMs?: number }) {
    this.model = options.model;
    // Stated rather than left to the SDK's own defaults: with the other two
    // adapters now bounded by LLM_TIMEOUT_MS, leaving this one to differ would
    // mean retry and timeout behaviour varying by provider — the exact thing
    // the provider interface exists to hide.
    const shared = { timeout: options.timeoutMs ?? env.LLM_TIMEOUT_MS, maxRetries: 1 };
    // A bare constructor resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an
    // `ant auth login` profile on its own; only override when a key is given.
    this.#client = new Anthropic(
      options.apiKey ? { ...shared, apiKey: options.apiKey } : shared,
    );
  }

  /**
   * The Product Context snapshot is byte-identical across repeated diagnoses,
   * so it goes in a cached system block. Confirm it is working by checking that
   * `usage.cacheReadInputTokens` is non-zero on the second call — a zero there
   * means something volatile leaked into the prefix.
   */
  #system(system: string) {
    return [
      {
        type: "text" as const,
        text: system,
        cache_control: { type: "ephemeral" as const },
      },
    ];
  }

  #assertUsable(response: { stop_reason: string | null; stop_details?: unknown }): void {
    if (response.stop_reason !== "refusal") return;
    const details = response.stop_details as { category?: string; explanation?: string } | null;
    throw new LLMError(
      `Request declined on policy grounds (${details?.category ?? "unknown"}): ` +
        `${details?.explanation ?? "no explanation given"}`,
      this.name,
      "refused",
    );
  }

  /**
   * Turns the SDK's typed exceptions into this codebase's failure vocabulary.
   * Without it a rate limit or a bad key escapes as a raw Anthropic error that
   * the boundary can only classify as INTERNAL.
   */
  async #call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof LLMError) throw error;
      throw new LLMError(describeAnthropicError(error), this.name, anthropicFailure(error), error);
    }
  }

  async completeText(req: CompletionRequest): Promise<CompletionResult<string>> {
    const response = await this.#call(() => this.#client.beta.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT_BY_KIND[req.kind] },
      system: this.#system(req.system),
      messages: [{ role: "user", content: req.user }],
    }));

    this.#assertUsable(response);

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    if (text.trim() === "") {
      throw new LLMError("Model returned no text content", this.name, "bad_output");
    }

    return { value: text, usage: toUsage(response.usage), model: response.model };
  }

  async completeStructured<T>(req: StructuredCompletionRequest<T>): Promise<CompletionResult<T>> {
    const response = await this.#call(() => this.#client.beta.messages.parse({
      model: this.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: {
        effort: EFFORT_BY_KIND[req.kind],
        format: zodOutputFormat(req.schema),
      },
      system: this.#system(req.system),
      messages: [{ role: "user", content: req.user }],
    }));

    this.#assertUsable(response);

    if (response.parsed_output == null) {
      throw new LLMError(
        `Model output did not satisfy schema "${req.schemaName}"`,
        this.name,
        "bad_output",
      );
    }

    return {
      value: response.parsed_output as T,
      usage: toUsage(response.usage),
      model: response.model,
    };
  }

  async health(): Promise<ProviderHealth> {
    try {
      const response = await this.#client.messages.create(
        {
          model: this.model,
          max_tokens: 16,
          output_config: { effort: "low" },
          messages: [{ role: "user", content: "Reply with the single word: ok" }],
        },
        // A health check that can block for the full request timeout is not a
        // health check.
        { timeout: env.LLM_HEALTH_TIMEOUT_MS, maxRetries: 0 },
      );
      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();
      return { ok: true, provider: this.name, model: this.model, detail: text || "(empty)" };
    } catch (error) {
      return {
        ok: false,
        provider: this.name,
        model: this.model,
        detail: describeAnthropicError(error),
      };
    }
  }
}

/** Same typed-exception ladder as describeAnthropicError, in the shared vocabulary. */
function anthropicFailure(error: unknown): LLMFailure {
  if (error instanceof Anthropic.AuthenticationError) return "auth";
  if (error instanceof Anthropic.RateLimitError) return "rate_limited";
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (error instanceof Anthropic.APIConnectionError) return "unreachable";
  return "server_error";
}

function describeAnthropicError(error: unknown): string {
  // Typed exception classes, most specific first — never string-match messages.
  if (error instanceof Anthropic.AuthenticationError) {
    return "authentication failed — set ANTHROPIC_API_KEY or run `ant auth login`";
  }
  if (error instanceof Anthropic.RateLimitError) return "rate limited";
  if (error instanceof Anthropic.NotFoundError) return "model not found";
  if (error instanceof Anthropic.APIConnectionError) return "could not reach the API";
  if (error instanceof Anthropic.APIError) return `API error ${error.status}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
