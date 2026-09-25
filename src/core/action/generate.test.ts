import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/core/errors";
import { EMPTY_USAGE, type LLMProvider } from "@/core/llm/types";
import { createMemoryStore } from "@/db/store/memory";

import { artifactKindFor, generateArtifact, metaLimits, truncateToLimit } from "./generate";

describe("truncateToLimit", () => {
  it("leaves content under the limit untouched", () => {
    expect(truncateToLimit("short post", 280)).toBe("short post");
  });

  it("leaves content exactly at the limit untouched", () => {
    const exact = "a".repeat(280);
    expect(truncateToLimit(exact, 280)).toBe(exact);
  });

  it("cuts at the last word boundary and marks the cut with an ellipsis", () => {
    const content = "word ".repeat(60).trim(); // well over 280 chars, all whole words
    const result = truncateToLimit(content, 280);
    expect(result.length).toBeLessThanOrEqual(280);
    expect(result.endsWith("…")).toBe(true);
    // No word was sliced in half — the character right before the ellipsis is
    // either a full "word" or the boundary space was dropped.
    expect(result.slice(0, -1).trim().endsWith("word") || result === "…").toBe(true);
  });

  it("hard-cuts a single unbroken word that has no space to back off to", () => {
    const content = "x".repeat(400);
    const result = truncateToLimit(content, 280);
    expect(result.length).toBe(280);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("artifactKindFor", () => {
  it("defaults to the channel's own kind", () => {
    expect(artifactKindFor("x")).toBe("x_post");
    expect(artifactKindFor("manual")).toBe("lp_copy");
  });

  it("lets a manual task produce meta tags or an email instead", () => {
    expect(artifactKindFor("manual", "meta")).toBe("meta");
    expect(artifactKindFor("manual", "email")).toBe("email");
  });

  /** Nothing but a post can go out through X, and a post is not something to paste by hand here. */
  it("refuses a kind the channel cannot use", () => {
    expect(() => artifactKindFor("x", "email")).toThrow(AppError);
    expect(() => artifactKindFor("manual", "x_post")).toThrow(AppError);
  });
});

describe("metaLimits", () => {
  it("is tighter for Japanese, which runs out of room on screen sooner", () => {
    expect(metaLimits("ja")).toEqual({ title: 32, description: 120 });
    expect(metaLimits("en")).toEqual({ title: 60, description: 160 });
  });
});

describe("generateArtifact", () => {
  async function setup(channel: "x" | "manual", primaryLanguage = "ja") {
    const db = createMemoryStore();
    const product = await db.products.insert({
      userId: "owner",
      url: "https://cheeeess.com/",
      name: "Cheeeess",
      setupStatus: "ready",
    });
    await db.productContexts.insert({
      productId: product.id,
      version: 1,
      what: "チェス",
      who: "初心者",
      why: "相手がいない",
      how: "開く",
      sourcePages: [],
      primaryLanguage,
    });
    const task = await db.tasks.insert({
        productId: product.id,
        title: "検索結果の見え方を直す",
        rationale: "r",
        stage: "reach",
        channel,
        expectedMetric: "m",
        impact: 3,
        effort: 2,
        dueWeek: "2026-W39",
    });
    return { db, task };
  }

  function fakeProvider(answers: Record<string, unknown>) {
    const seen: string[] = [];
    const provider = {
      name: "fake",
      model: "fake",
      health: vi.fn(),
      completeText: vi.fn(),
      completeStructured: vi.fn(async (req: { schemaName: string; system: string }) => {
        seen.push(req.schemaName);
        return { value: answers[req.schemaName], usage: EMPTY_USAGE, model: "fake" };
      }),
    } as unknown as LLMProvider;
    return { provider, seen };
  }

  it("writes meta tags as two labelled lines, cut to the search-result limits", async () => {
    const { db, task } = await setup("manual");
    const { provider, seen } = fakeProvider({
      meta_tags: { title: "Cheeeess｜ブラウザで今すぐチェス対局".padEnd(50, "あ"), description: "初心者でも" },
    });

    const artifact = await generateArtifact(task.id, { database: db, provider, kind: "meta" });

    expect(seen).toEqual(["meta_tags"]);
    expect(artifact.kind).toBe("meta");
    const [title, description] = artifact.content.split("\n");
    expect(title.startsWith("title: ")).toBe(true);
    expect(title.slice("title: ".length).length).toBeLessThanOrEqual(32);
    expect(description).toBe("description: 初心者でも");
  });

  it("writes an email as a subject line and a body, labelled in the product's language", async () => {
    const { db, task } = await setup("manual", "en");
    const { provider } = fakeProvider({ email: { subject: "A quick update", body: "Hi [Name],\n\nThanks." } });

    const artifact = await generateArtifact(task.id, { database: db, provider, kind: "email" });

    expect(artifact.kind).toBe("email");
    expect(artifact.content).toBe("Subject: A quick update\n\nHi [Name],\n\nThanks.");
  });

  it("keeps the old default when no kind is asked for", async () => {
    const { db, task } = await setup("manual");
    const { provider, seen } = fakeProvider({ artifact_content: { content: "LPの文章" } });

    const artifact = await generateArtifact(task.id, { database: db, provider });

    expect(seen).toEqual(["artifact_content"]);
    expect(artifact).toMatchObject({ kind: "lp_copy", content: "LPの文章" });
  });

  it("refuses before spending a model call when the kind does not fit the channel", async () => {
    const { db, task } = await setup("x");
    const { provider } = fakeProvider({});

    await expect(generateArtifact(task.id, { database: db, provider, kind: "email" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(provider.completeStructured).not.toHaveBeenCalled();
  });
});
