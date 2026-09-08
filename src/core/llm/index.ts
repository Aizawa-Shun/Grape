import { env, type LLMProviderName } from "@/env";

import { AnthropicProvider } from "./anthropic";
import { OllamaProvider } from "./ollama";
import { OpenAICompatProvider } from "./openai-compat";
import type { LLMProvider } from "./types";

export * from "./types";
export { AnthropicProvider } from "./anthropic";
export { OllamaProvider } from "./ollama";
export { OpenAICompatProvider } from "./openai-compat";

function build(name: LLMProviderName): LLMProvider {
  switch (name) {
    case "anthropic":
      return new AnthropicProvider({
        model: env.ANTHROPIC_MODEL,
        apiKey: env.ANTHROPIC_API_KEY,
      });
    case "ollama":
      return new OllamaProvider({
        model: env.OLLAMA_MODEL,
        baseUrl: env.OLLAMA_BASE_URL,
      });
    case "openai-compat":
      return new OpenAICompatProvider({
        model: env.OPENAI_MODEL,
        baseUrl: env.OPENAI_BASE_URL,
        apiKey: env.OPENAI_API_KEY,
      });
  }
}

const cache = new Map<LLMProviderName, LLMProvider>();

/**
 * The single place the rest of Grape acquires a model. Nothing above the
 * Intelligence layer should import a concrete provider — that is what makes
 * LLM_PROVIDER a real switch rather than a comment.
 */
export function getProvider(name: LLMProviderName = env.LLM_PROVIDER): LLMProvider {
  const existing = cache.get(name);
  if (existing) return existing;
  const provider = build(name);
  cache.set(name, provider);
  return provider;
}
