import type { Usage } from "./types";

/**
 * Estimated cost, not billed cost — this exists so `budget.ts` can stop
 * spending before the bill arrives, not to reconcile against it. Prices are
 * per-provider list prices as of 2026-09; a provider changing prices makes
 * this table stale, not wrong in a way that breaks anything, since the guard
 * only needs to be roughly right to stop a runaway loop.
 *
 * Keyed by prefix rather than exact model string: Anthropic and OpenAI both
 * return a versioned model name in the response (e.g. a dated snapshot) that
 * rarely matches the alias in settings verbatim.
 */
interface Rate {
  /** USD per input token. */
  input: number;
  /** USD per output token. */
  output: number;
  /** USD per cached-read input token — far cheaper than a fresh input token. */
  cacheRead: number;
  /** USD per cache-write input token — pricier than a fresh input token. */
  cacheWrite: number;
}

const RATES: [prefix: string, rate: Rate][] = [
  // Anthropic. Cache read/write multipliers (0.1x / 1.25x of input) are
  // consistent across Claude models, so applied to whatever input price
  // matches the prefix rather than repeated per row.
  ["claude-opus", { input: 15e-6, output: 75e-6, cacheRead: 1.5e-6, cacheWrite: 18.75e-6 }],
  ["claude-sonnet", { input: 3e-6, output: 15e-6, cacheRead: 0.3e-6, cacheWrite: 3.75e-6 }],
  ["claude-haiku", { input: 0.8e-6, output: 4e-6, cacheRead: 0.08e-6, cacheWrite: 1e-6 }],

  // OpenAI-compatible. Only meaningful against the real OpenAI endpoint — a
  // local vLLM/llama.cpp server behind this adapter costs nothing to run, but
  // this table has no way to know that from the model string alone, so it
  // prices as if it were the real API. See FALLBACK for the safe direction.
  ["gpt-4o-mini", { input: 0.15e-6, output: 0.6e-6, cacheRead: 0.075e-6, cacheWrite: 0.15e-6 }],
  ["gpt-4o", { input: 2.5e-6, output: 10e-6, cacheRead: 1.25e-6, cacheWrite: 2.5e-6 }],
];

/**
 * Ollama runs on the caller's own machine — there is no bill, so it is priced
 * at exactly zero rather than falling through to a nonzero default.
 */
const OLLAMA_RATE: Rate = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/**
 * Unrecognized model on a paid provider: price it as the most expensive known
 * rate rather than zero. A budget guard that under-counts an unknown model
 * fails open — exactly the failure mode this exists to prevent.
 */
const FALLBACK_RATE: Rate = RATES[0][1];

function rateFor(provider: string, model: string): Rate {
  if (provider === "ollama") return OLLAMA_RATE;
  const match = RATES.find(([prefix]) => model.startsWith(prefix));
  return match ? match[1] : FALLBACK_RATE;
}

export function estimateCostUsd(provider: string, model: string, usage: Usage): number {
  const rate = rateFor(provider, model);
  return (
    usage.inputTokens * rate.input +
    usage.outputTokens * rate.output +
    usage.cacheReadInputTokens * rate.cacheRead +
    usage.cacheCreationInputTokens * rate.cacheWrite
  );
}
