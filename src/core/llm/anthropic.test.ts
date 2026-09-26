import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { isOutOfCredit } from "./anthropic";

function badRequest(message: string) {
  return new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message } }, message, new Headers());
}

describe("isOutOfCredit", () => {
  it("recognises the API's empty-balance answer", () => {
    expect(isOutOfCredit(badRequest("Your credit balance is too low to access the Anthropic API."))).toBe(true);
  });

  it("does not mistake other bad requests for it", () => {
    expect(isOutOfCredit(badRequest("The compiled grammar is too large"))).toBe(false);
    expect(isOutOfCredit(new Error("credit balance"))).toBe(false);
  });
});
