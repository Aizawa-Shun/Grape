import { describe, expect, it } from "vitest";

import { EMPTY_USAGE, type Usage } from "./types";
import { estimateCostUsd } from "./pricing";

function usage(overrides: Partial<Usage> = {}): Usage {
  return { ...EMPTY_USAGE, ...overrides };
}

describe("estimateCostUsd", () => {
  it("matches a known model by prefix", () => {
    const cost = estimateCostUsd("anthropic", "claude-opus-5-20260501", usage({ inputTokens: 1_000_000 }));
    expect(cost).toBeCloseTo(5, 5);
  });

  it("charges output tokens at the output rate, not the input rate", () => {
    const cost = estimateCostUsd("anthropic", "claude-sonnet-5", usage({ outputTokens: 1_000_000 }));
    expect(cost).toBeCloseTo(10, 5);
  });

  it("charges cache reads far below a fresh input token", () => {
    const fresh = estimateCostUsd("anthropic", "claude-haiku-4-5", usage({ inputTokens: 1_000_000 }));
    const cached = estimateCostUsd(
      "anthropic",
      "claude-haiku-4-5",
      usage({ cacheReadInputTokens: 1_000_000 }),
    );
    expect(cached).toBeLessThan(fresh);
  });

  it("falls back to the most expensive known rate for an unrecognized paid model, never to zero", () => {
    const known = estimateCostUsd("anthropic", "claude-fable-5-1", usage({ inputTokens: 1_000_000 }));
    const unknown = estimateCostUsd("openai-compat", "some-future-model", usage({ inputTokens: 1_000_000 }));
    expect(unknown).toBe(known);
    expect(unknown).toBeGreaterThan(0);
  });

  it("returns zero for a zero-usage call", () => {
    expect(estimateCostUsd("anthropic", "claude-opus-5", usage())).toBe(0);
  });
});
