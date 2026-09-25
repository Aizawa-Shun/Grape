import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { createHackerNewsSource, hitToCandidate } from "./hackernews";
import { htmlToText } from "./types";
import { collectSources } from "./web";
import { buildXQuery } from "./x";

describe("Hacker News source", () => {
  it("turns hits into candidates with a link back to the thread", () => {
    expect(hitToCandidate({ objectID: "7", author: "pg", comment_text: "<p>Is there a tool for &quot;this&quot;?</p>", created_at_i: 1_700_000_000 })).toMatchObject({
      externalId: "7",
      url: "https://news.ycombinator.com/item?id=7",
      text: 'Is there a tool for "this"?',
    });
    expect(hitToCandidate({ objectID: "8" })).toBeNull();
  });

  it("keeps going when one query fails", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      if (calls === 1) throw new Error("timeout");
      return new Response(JSON.stringify({ hits: [{ objectID: "9", author: "a", title: "How do I find my first users?" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const found = await createHackerNewsSource(fakeFetch).search(["a", "b"], { sinceDays: 30, limit: 10 });
    expect(found.map((c) => c.externalId)).toEqual(["9"]);
  });
});

describe("buildXQuery", () => {
  it("ORs phrases, quotes multi-word ones, and excludes retweets", () => {
    expect(buildXQuery(["first users", "saas"], "en-US")).toBe('("first users" OR saas) -is:retweet lang:en');
  });

  it("stays under X's query length limit", () => {
    const query = buildXQuery(Array.from({ length: 100 }, (_, i) => `phrase number ${i}`));
    expect(query.length).toBeLessThanOrEqual(512);
  });
});

describe("collectSources", () => {
  it("lists only what the search returned, deduplicated, with quotes from citations", () => {
    const content = [
      {
        type: "web_search_tool_result",
        tool_use_id: "t",
        content: [
          { type: "web_search_result", url: "https://a.example/", title: "A", encrypted_content: "", page_age: null },
          { type: "web_search_result", url: "https://a.example/", title: "A", encrypted_content: "", page_age: null },
        ],
      },
      {
        type: "text",
        text: "Users say it is slow.",
        citations: [{ type: "web_search_result_location", url: "https://b.example/", title: "B", cited_text: "it is so slow", encrypted_index: "" }],
      },
    ] as unknown as Anthropic.Beta.BetaContentBlock[];
    const { sources, citations, text } = collectSources(content);
    expect(sources.map((s) => s.url)).toEqual(["https://a.example/", "https://b.example/"]);
    expect(citations).toEqual([{ url: "https://b.example/", title: "B", quote: "it is so slow" }]);
    expect(text).toBe("Users say it is slow.");
  });
});

describe("htmlToText", () => {
  it("keeps paragraph breaks and decodes entities", () => {
    expect(htmlToText("a<p>b &amp; c")).toBe("a\n\nb & c");
  });
});
