import { describe, expect, it } from "vitest";

import { xWeightedLength } from "@/core/action/channels/x-text";

import { composeReply, mayMentionProduct } from "./reply-generator";

describe("mayMentionProduct", () => {
  const strong = { relevance: 90, intent: "seeking_solution" as const };
  const weak = { relevance: 60, intent: "discussion" as const };

  it("never mentions the product at intensity 1, however good the match", () => {
    expect(mayMentionProduct(1, strong)).toBe(false);
  });

  it("mentions it at moderate intensity only for a strong, solution-seeking match", () => {
    expect(mayMentionProduct(3, strong)).toBe(true);
    expect(mayMentionProduct(3, weak)).toBe(false);
  });

  it("mentions it whenever there is a bridge at high intensity", () => {
    expect(mayMentionProduct(5, weak)).toBe(true);
  });
});

describe("composeReply", () => {
  it("attaches the bridge only when allowed", () => {
    expect(composeReply("答え", "自分も作っています", false, true)).toEqual({ text: "答え", mentionsProduct: false });
    expect(composeReply("答え", "自分も作っています", true, true)).toEqual({ text: "答え\n\n自分も作っています", mentionsProduct: true });
  });

  it("drops the bridge, not the answer, when both do not fit on X", () => {
    const answer = "あ".repeat(130);
    const result = composeReply(answer, "い".repeat(40), true, true);
    expect(result.mentionsProduct).toBe(false);
    expect(result.text).toBe(answer);
    expect(xWeightedLength(result.text)).toBeLessThanOrEqual(280);
  });
});
