import { parseStructured, stripThinkBlocks, toProviderJsonSchema } from "./json-schema";
import {
  EMPTY_USAGE,
  LLMError,
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
 * Any OpenAI-compatible /v1/chat/completions endpoint: OpenAI itself, LM
 * Studio, vLLM, llama.cpp's server, or Ollama's compatibility shim.
 *
 * Kept separate from OllamaProvider because the native Ollama API reports
 * different fields and takes the schema as `format` rather than
 * `response_format` — collapsing them would mean one adapter lying about the
 * other's behaviour.
 */
export class OpenAICompatProvider implements LLMProvider {
  readonly name = "openai-compat";
  readonly model: string;
  readonly #baseUrl: string;
  readonly #apiKey?: string;

  constructor(options: { model: string; baseUrl: string; apiKey?: string }) {
    this.model = options.model;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
  }

  async #chat(
    req: CompletionRequest,
    responseFormat?: unknown,
  ): Promise<{ text: string; usage: Usage; model: string }> {
    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}/chat/completions`, {
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
      });
    } catch (error) {
      throw new LLMError(`Could not reach ${this.#baseUrl}`, this.name, error);
    }

    if (!response.ok) {
      throw new LLMError(
        `Endpoint returned ${response.status}: ${(await response.text()).slice(0, 300)}`,
        this.name,
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
    const { text, usage, model } = await this.#chat(req, {
      type: "json_schema",
      json_schema: {
        name: req.schemaName,
        strict: true,
        schema: toProviderJsonSchema(req.schema),
      },
    });
    return {
      value: parseStructured(text, req.schema, this.name, req.schemaName),
      usage,
      model,
    };
  }

  async health(): Promise<ProviderHealth> {
    try {
      const response = await fetch(`${this.#baseUrl}/models`, {
        headers: this.#apiKey ? { authorization: `Bearer ${this.#apiKey}` } : {},
      });
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
