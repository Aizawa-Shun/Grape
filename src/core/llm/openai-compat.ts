import { currentSettings } from "@/core/settings";

import { fetchModel } from "./http";
import { stripThinkBlocks, toProviderJsonSchema } from "./json-schema";
import { completeStructuredWithRepair } from "./structured";
import {
  EMPTY_USAGE,
  LLMError,
  failureForStatus,
  type CompletionRequest,
  type CompletionResult,
  type LLMProvider,
  type ProviderHealth,
  type StructuredCompletionRequest,
  type Usage,
} from "./types";

interface ChatCompletionResponse {
  model?: string;
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Any OpenAI-compatible /v1/chat/completions endpoint: OpenAI itself, or a
 * self-hosted server (LM Studio, vLLM, llama.cpp's server) that speaks the
 * same API.
 */
export class OpenAICompatProvider implements LLMProvider {
  readonly name = "openai-compat";
  readonly model: string;
  readonly #baseUrl: string;
  readonly #apiKey?: string;
  readonly #timeoutMs: number;
  readonly #maxAttempts: number;

  constructor(options: {
    model: string;
    baseUrl: string;
    apiKey?: string;
    timeoutMs?: number;
    maxRepairs?: number;
  }) {
    this.model = options.model;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#timeoutMs = options.timeoutMs ?? currentSettings().LLM_TIMEOUT_MS;
    this.#maxAttempts = (options.maxRepairs ?? currentSettings().LLM_MAX_REPAIRS) + 1;
  }

  async #chat(
    req: CompletionRequest,
    responseFormat?: unknown,
  ): Promise<{ text: string; usage: Usage; model: string }> {
    const response = await fetchModel(
      `${this.#baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.#apiKey ? { authorization: `Bearer ${this.#apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens ?? 4096,
          ...(responseFormat ? { response_format: responseFormat } : {}),
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        }),
      },
      { timeoutMs: this.#timeoutMs, provider: this.name },
    );

    if (!response.ok) {
      throw new LLMError(
        `Endpoint returned ${response.status}: ${(await response.text()).slice(0, 300)}`,
        this.name,
        failureForStatus(response.status),
      );
    }

    const body = (await response.json()) as ChatCompletionResponse;
    return {
      text: body.choices?.[0]?.message?.content ?? "",
      model: body.model ?? this.model,
      usage: {
        ...EMPTY_USAGE,
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
      },
    };
  }

  async completeText(req: CompletionRequest): Promise<CompletionResult<string>> {
    const { text, usage, model } = await this.#chat(req);
    return { value: stripThinkBlocks(text), usage, model };
  }

  async completeStructured<T>(req: StructuredCompletionRequest<T>): Promise<CompletionResult<T>> {
    return completeStructuredWithRepair((r, format) => this.#chat(r, format), req, {
      provider: this.name,
      maxAttempts: this.#maxAttempts,
      format: {
        type: "json_schema",
        json_schema: {
          name: req.schemaName,
          strict: true,
          schema: toProviderJsonSchema(req.schema),
        },
      },
    });
  }

  async health(): Promise<ProviderHealth> {
    try {
      const response = await fetchModel(
        `${this.#baseUrl}/models`,
        { headers: this.#apiKey ? { authorization: `Bearer ${this.#apiKey}` } : {} },
        { timeoutMs: currentSettings().LLM_HEALTH_TIMEOUT_MS, provider: this.name },
      );
      return {
        ok: response.ok,
        provider: this.name,
        model: this.model,
        detail: response.ok ? "endpoint reachable" : `endpoint returned ${response.status}`,
      };
    } catch (error) {
      return {
        ok: false,
        provider: this.name,
        model: this.model,
        detail: `could not reach ${this.#baseUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
