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

/** Anthropic's cache multipliers: reads 0.1x input, 5-minute writes 1.25x input. */
function claude(inputPerMTok: number, outputPerMTok: number): Rate {
  const input = inputPerMTok / 1e6;
  return { input, output: outputPerMTok / 1e6, cacheRead: input * 0.1, cacheWrite: input * 1.25 };
}

/**
 * Most specific prefix first — `claude-opus-4-8` must match its own row
 * before the older `claude-opus-4` one. The first row is the most expensive
 * and is also the fallback (see FALLBACK_RATE).
 */
const RATES: [prefix: string, rate: Rate][] = [
  // Anthropic list prices, 2026-09.
  ["claude-fable", claude(10, 50)],
  ["claude-mythos", claude(10, 50)],
  ["claude-opus-5-5", claude(4, 20)],
  ["claude-opus-5", claude(5, 25)],
  ["claude-opus-4-8", claude(5, 25)],
  ["claude-opus-4-7", claude(5, 25)],
  ["claude-opus-4-6", claude(5, 25)],
  ["claude-opus-4-5", claude(5, 25)],
  ["claude-opus", claude(15, 75)],
  ["claude-sonnet-5", claude(2, 10)],
  ["claude-sonnet", claude(3, 15)],
  ["claude-haiku", claude(1, 5)],

  // OpenAI-compatible. Only meaningful against the real OpenAI endpoint — a
  // local vLLM/llama.cpp server behind this adapter costs nothing to run, but
  // this table has no way to know that from the model string alone, so it
  // prices as if it were the real API. See FALLBACK for the safe direction.
  ["gpt-4o-mini", { input: 0.15e-6, output: 0.6e-6, cacheRead: 0.075e-6, cacheWrite: 0.15e-6 }],
  ["gpt-4o", { input: 2.5e-6, output: 10e-6, cacheRead: 1.25e-6, cacheWrite: 2.5e-6 }],
];

/**
 * Unrecognized model on a paid provider: price it as the most expensive known
 * rate rather than zero. A budget guard that under-counts an unknown model
 * fails open — exactly the failure mode this exists to prevent.
 */
const FALLBACK_RATE: Rate = RATES[0][1];

function rateFor(_provider: string, model: string): Rate {
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
