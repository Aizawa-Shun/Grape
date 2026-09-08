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

interface OllamaChatResponse {
  model?: string;
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Local models via Ollama's native /api/chat.
 *
 * This is the escape hatch that keeps Grape from being a single-vendor SaaS.
 * It is not the default: measured on the machine this was built on (4-core
 * mobile CPU, 8 GB RAM, no discrete GPU), *processing* the prompt — not
 * generating the reply — is the bottleneck. A 4B reasoning model took over 5
 * minutes just to read a ~900-token prompt. A 1.5B instruct model manages
 * ~40 tokens/sec of prompt throughput instead, which is why it is the default
 * OLLAMA_MODEL (see .env.example) rather than something larger. Set
 * LLM_PROVIDER=ollama to use it anyway — the call sites above this file do
 * not change.
 */
export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  readonly model: string;
  readonly #baseUrl: string;

  constructor(options: { model: string; baseUrl: string }) {
    this.model = options.model;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  async #chat(req: CompletionRequest, format?: unknown): Promise<{ text: string; usage: Usage; model: string }> {
    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          // Reasoning models (qwen3 and friends) default to emitting a
          // <think>...</think> block before any real content. Measured on this
          // machine, that alone can burn the entire token budget on a small
          // `num_predict` and return empty content — `think: false` skips
          // straight to the answer. Harmless no-op on non-reasoning models.
          think: false,
          ...(format ? { format } : {}),
          options: { num_predict: req.maxTokens ?? 4096 },
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        }),
      });
    } catch (error) {
      throw new LLMError(`Could not reach Ollama at ${this.#baseUrl}`, this.name, error);
    }

    if (!response.ok) {
      throw new LLMError(
        `Ollama returned ${response.status}: ${(await response.text()).slice(0, 300)}`,
        this.name,
      );
    }

    const body = (await response.json()) as OllamaChatResponse;
    return {
      text: body.message?.content ?? "",
      model: body.model ?? this.model,
      usage: {
        ...EMPTY_USAGE,
        inputTokens: body.prompt_eval_count ?? 0,
        outputTokens: body.eval_count ?? 0,
      },
    };
  }

  async completeText(req: CompletionRequest): Promise<CompletionResult<string>> {
    const { text, usage, model } = await this.#chat(req);
    return { value: stripThinkBlocks(text), usage, model };
  }

  async completeStructured<T>(req: StructuredCompletionRequest<T>): Promise<CompletionResult<T>> {
    // Ollama compiles the JSON Schema into a decoding grammar.
    const { text, usage, model } = await this.#chat(req, toProviderJsonSchema(req.schema));
    return {
      value: parseStructured(text, req.schema, this.name, req.schemaName),
      usage,
      model,
    };
  }

  async health(): Promise<ProviderHealth> {
    try {
      const response = await fetch(`${this.#baseUrl}/api/tags`);
      if (!response.ok) {
        return {
          ok: false,
          provider: this.name,
          model: this.model,
          detail: `Ollama returned ${response.status}`,
        };
      }
      const body = (await response.json()) as { models?: { name?: string }[] };
      const installed = (body.models ?? []).map((m) => m.name).filter(Boolean) as string[];
      const present = installed.some((n) => n === this.model || n.startsWith(`${this.model}:`));
      return {
        ok: present,
        provider: this.name,
        model: this.model,
        detail: present
          ? `model available (${installed.length} installed)`
          : `model not pulled — run \`ollama pull ${this.model}\`. Installed: ${installed.join(", ") || "none"}`,
      };
    } catch (error) {
      return {
        ok: false,
        provider: this.name,
        model: this.model,
        detail: `could not reach Ollama at ${this.#baseUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
