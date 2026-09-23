import { getLlmApiKey } from "@/core/auth/users";
import { AppError } from "@/core/errors";
import { currentSettings } from "@/core/settings";
import { isLocalHost, type LLMProviderName } from "@/env";
import { currentUserId } from "@/server/context";

import { AnthropicProvider } from "./anthropic";
import { withBudgetGuard } from "./budget";
import { OpenAICompatProvider } from "./openai-compat";
import type { LLMProvider } from "./types";

export * from "./types";
export { AnthropicProvider } from "./anthropic";
export { OpenAICompatProvider } from "./openai-compat";

function build(name: LLMProviderName, apiKey: string | undefined): LLMProvider {
  const settings = currentSettings();

  switch (name) {
    case "anthropic":
      return new AnthropicProvider({ model: settings.ANTHROPIC_MODEL, apiKey });
    case "openai-compat":
      return new OpenAICompatProvider({
        model: settings.OPENAI_MODEL,
        baseUrl: settings.OPENAI_BASE_URL,
        apiKey,
      });
  }
}

/**
 * Keyed by the configuration itself and by whose key it holds.
 *
 * Providers capture the model, the base URL and the timeouts at construction,
 * so a name-keyed cache would keep serving the old ones after someone changes
 * a setting. Including the values in the key means the cache invalidates
 * itself — and it avoids core/settings having to import this module to clear
 * it, which would be a cycle, since the adapters import core/settings.
 * `userId` joins them for the same reason as any other value that changes
 * what gets built: a provider constructed with one account's API key must
 * never be handed to another account by a cache that only looked at the model
 * name.
 */
const cache = new Map<string, LLMProvider>();
const MAX_CACHED = 8;

function cacheKey(name: LLMProviderName, userId: string): string {
  const s = currentSettings();
  return [
    name,
    userId,
    s.ANTHROPIC_MODEL,
    s.OPENAI_BASE_URL,
    s.OPENAI_MODEL,
    s.LLM_TIMEOUT_MS,
    s.LLM_HEALTH_TIMEOUT_MS,
    s.LLM_MAX_REPAIRS,
  ].join(" ");
}

/**
 * Whether the instance has a service selected at all. Split out from
 * `getProvider` so a caller with a non-AI fallback — core/context/extract.ts's
 * rule-based reading of the page — can choose that path without provoking and
 * catching the exception below.
 *
 * Instance-level only, deliberately: whether *this* user specifically has
 * their own key on file is a second, separate question, and answering it
 * needs a database read — the exact cost this synchronous check exists to let
 * a caller skip when AI is not even selected.
 */
export function llmAvailable(): boolean {
  return currentSettings().LLM_PROVIDER !== undefined;
}

/**
 * The single place the rest of Grape acquires a model. Nothing above the
 * Intelligence layer should import a concrete provider — that is what makes
 * the provider setting a real switch rather than a comment.
 *
 * Async now that the credential is per-account rather than a shared instance
 * secret: this has to read the current user's own key out of the database
 * (and decrypt it — see server/secret-box.ts) before a provider can even be
 * constructed. `currentUserId()` is the account that opened the request (see
 * server/context.ts), which is always the product's owner by the time
 * anything reaches here — every route that calls into diagnosis, task
 * recommendation, artifact generation or extraction has already checked
 * ownership before doing so.
 *
 * Throws when nothing is usable rather than returning something null-like:
 * every current caller has nothing useful left to do without a model, so
 * there is no meaningful "not configured" value of `LLMProvider` for it to
 * return instead. Which of three things is missing changes the hint, because
 * only one of them is this particular user's to fix: no provider selected is
 * the instance owner's problem (/settings), no session is a login problem,
 * and no key on file is this account's own (/account).
 */
export async function getProvider(name?: LLMProviderName): Promise<LLMProvider> {
  const providerName = name ?? currentSettings().LLM_PROVIDER;
  if (!providerName) {
    throw new AppError("LLM_NOT_CONFIGURED", "No LLM_PROVIDER is configured", {
      hint: "設定画面でAIの接続先を選んでください。",
    });
  }

  const userId = currentUserId();
  if (!userId) {
    // Reachable only outside a real request — a script, or a route that never
    // established a session — since every route that reaches here for an
    // actual user has already gone through requireUser().
    throw new AppError("LLM_NOT_CONFIGURED", "No signed-in account to read an API key for", {
      hint: "ログインしてください。",
    });
  }

  const apiKey = await getLlmApiKey(userId, providerName);
  // The one case that genuinely needs no key: a self-hosted openai-compat
  // endpoint on loopback. Anthropic has no keyless endpoint, and a remote
  // openai-compat one cannot authenticate with nothing to send.
  const keyless = providerName === "openai-compat" && isLocalHost(currentSettings().OPENAI_BASE_URL);
  if (!apiKey && !keyless) {
    throw new AppError("LLM_NOT_CONFIGURED", `No API key set for ${providerName}`, {
      hint: "アカウント画面で自分のAPIキーを設定してください。",
    });
  }

  const key = cacheKey(providerName, userId);
  const existing = cache.get(key);
  if (existing) return existing;

  // Settings change rarely, so this only trims after a burst of edits.
  if (cache.size >= MAX_CACHED) cache.clear();

  // Guarded before caching, not after: the cache is keyed by configuration
  // (see cacheKey), and the guard reads settings itself on every call anyway,
  // so wrapping first means the cached value is the one thing every caller
  // should ever hold.
  const provider = withBudgetGuard(build(providerName, apiKey));
  cache.set(key, provider);
  return provider;
}
