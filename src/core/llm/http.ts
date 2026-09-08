import { LLMError } from "./types";

/**
 * Every HTTP call to a model goes through here, because neither the Ollama nor
 * the OpenAI-compatible adapter had any timeout at all: on the hardware this
 * runs on a diagnose call can legitimately take a minute, and a stalled one
 * previously held a Node request open until the browser gave up, with the page
 * showing no sign of it.
 *
 * It also decides `timeout` versus `unreachable` here rather than leaving the
 * boundary to guess from a message.
 */
export async function fetchModel(
  url: string,
  init: RequestInit,
  options: { timeoutMs: number; provider: string; fetchImpl?: typeof fetch },
): Promise<Response> {
  const doFetch = options.fetchImpl ?? fetch;

  try {
    return await doFetch(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs) });
  } catch (error) {
    if (isTimeout(error)) {
      throw new LLMError(
        `${url} did not respond within ${options.timeoutMs}ms`,
        options.provider,
        "timeout",
        error,
      );
    }
    throw new LLMError(`Could not reach ${url}`, options.provider, "unreachable", error);
  }
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}
