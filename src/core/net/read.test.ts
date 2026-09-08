import { describe, expect, it } from "vitest";

import { readTextCapped } from "./read";

function streamed(chunks: string[], headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { headers });
}

describe("readTextCapped", () => {
  it("returns a small body whole", async () => {
    const result = await readTextCapped(streamed(["<html>", "hello", "</html>"]), 1024);

    expect(result.text).toBe("<html>hello</html>");
    expect(result.truncated).toBe(false);
  });

  it("stops at the cap instead of reading an unbounded body into memory", async () => {
    const result = await readTextCapped(streamed(["a".repeat(50), "b".repeat(50)]), 60);

    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(60);
  });

  it("does not even start reading when the declared length is over the cap", async () => {
    const response = streamed(["x".repeat(100)], { "content-length": "999999" });

    const result = await readTextCapped(response, 1024);

    expect(result).toEqual({ text: "", truncated: true });
  });

  it("handles a body-less response", async () => {
    const result = await readTextCapped(new Response(null, { status: 204 }), 1024);

    expect(result.text).toBe("");
  });
});
