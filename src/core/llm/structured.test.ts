import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { fetchModel } from "./http";
import { completeStructuredWithRepair } from "./structured";
import { EMPTY_USAGE, LLMError, type CompletionRequest, type StructuredCompletionRequest } from "./types";

const Schema = z.object({ summary: z.string(), confidence: z.number() });

function request(): StructuredCompletionRequest<z.infer<typeof Schema>> {
  return {
    kind: "diagnose",
    schemaName: "diagnosis",
    schema: Schema,
    system: "# Product Context\nWhat: chess",
    user: "# ファネル\nVisit: 20",
  };
}

function chatReturning(...texts: string[]) {
  const seen: CompletionRequest[] = [];
  let call = 0;
  const chat = async (req: CompletionRequest) => {
    seen.push(req);
    return { text: texts[Math.min(call++, texts.length - 1)], usage: EMPTY_USAGE, model: "test" };
  };
  return { chat, seen };
}

const valid = JSON.stringify({ summary: "ok", confidence: 0.7 });

describe("completeStructuredWithRepair", () => {
  it("returns on the first attempt without re-asking", async () => {
    const { chat, seen } = chatReturning(valid);

    const result = await completeStructuredWithRepair(chat, request(), {
      provider: "ollama",
      maxAttempts: 2,
    });

    expect(result.value.summary).toBe("ok");
    expect(seen).toHaveLength(1);
  });

  it("recovers from one broken reply, which is the whole point on a small model", async () => {
    const { chat, seen } = chatReturning("Sure! Here you go: {oops", valid);

    const result = await completeStructuredWithRepair(chat, request(), {
      provider: "ollama",
      maxAttempts: 2,
    });

    expect(result.value.confidence).toBe(0.7);
    expect(seen).toHaveLength(2);
  });

  it("shows the model its own bad output and why it was rejected", async () => {
    const { chat, seen } = chatReturning("总之 not json at all", valid);

    await completeStructuredWithRepair(chat, request(), { provider: "ollama", maxAttempts: 2 });

    const retry = seen[1].user;
    expect(retry).toContain("总之 not json at all");
    expect(retry).toContain("JSONオブジェクトだけを出力してください");
  });

  it("leaves the system prompt untouched, so prefix caching survives the retry", async () => {
    const { chat, seen } = chatReturning("nope", valid);

    await completeStructuredWithRepair(chat, request(), { provider: "ollama", maxAttempts: 2 });

    expect(seen[0].system).toBe(seen[1].system);
    expect(seen[1].user.startsWith(seen[0].user)).toBe(true);
  });

  it("gives up after the allowed attempts rather than looping", async () => {
    const { chat, seen } = chatReturning("junk", "junk", "junk");

    await expect(
      completeStructuredWithRepair(chat, request(), { provider: "ollama", maxAttempts: 2 }),
    ).rejects.toMatchObject({ failure: "bad_output" });

    expect(seen).toHaveLength(2);
  });

  it("does not re-ask at all when repairs are disabled", async () => {
    const { chat, seen } = chatReturning("junk", valid);

    await expect(
      completeStructuredWithRepair(chat, request(), { provider: "ollama", maxAttempts: 1 }),
    ).rejects.toBeInstanceOf(LLMError);

    expect(seen).toHaveLength(1);
  });

  it("retries output that parses but has the wrong shape, not just unparseable text", async () => {
    const { chat, seen } = chatReturning(JSON.stringify({ summary: "ok" }), valid);

    const result = await completeStructuredWithRepair(chat, request(), {
      provider: "ollama",
      maxAttempts: 2,
    });

    expect(result.value.confidence).toBe(0.7);
    expect(seen[1].user).toContain("confidence");
  });
});

describe("fetchModel", () => {
  it("classifies a stalled endpoint as a timeout, not as unreachable", async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason));
      });

    await expect(
      fetchModel("http://localhost:11434/api/chat", {}, {
        timeoutMs: 10,
        provider: "ollama",
        fetchImpl: hang,
      }),
    ).rejects.toMatchObject({ failure: "timeout" });
  });

  it("classifies a refused connection as unreachable", async () => {
    const refuse: typeof fetch = () => Promise.reject(new TypeError("fetch failed"));

    await expect(
      fetchModel("http://localhost:11434/api/chat", {}, {
        timeoutMs: 1000,
        provider: "ollama",
        fetchImpl: refuse,
      }),
    ).rejects.toMatchObject({ failure: "unreachable" });
  });

  it("passes a successful response straight through", async () => {
    const ok: typeof fetch = async () => new Response("{}", { status: 200 });

    const response = await fetchModel("http://x/api", {}, {
      timeoutMs: 1000,
      provider: "ollama",
      fetchImpl: ok,
    });

    expect(response.status).toBe(200);
  });

  it("aborts the request rather than merely giving up on it", async () => {
    const abortSeen = vi.fn();
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          abortSeen();
          reject((init.signal as AbortSignal).reason);
        });
      });

    await expect(
      fetchModel("http://x/api", {}, { timeoutMs: 10, provider: "ollama", fetchImpl: hang }),
    ).rejects.toBeInstanceOf(LLMError);

    expect(abortSeen).toHaveBeenCalled();
  });
});
