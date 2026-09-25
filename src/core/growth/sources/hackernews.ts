import { readTextCapped } from "@/core/net/read";

import { htmlToText, type ConversationCandidate, type ConversationSource, type SearchOptions } from "./types";

/**
 * Hacker News, through Algolia's public search API.
 *
 * The one conversation source that needs no key and costs nothing, which is
 * why it is always on: a fresh Grape with no X credentials still finds real
 * people asking real questions, rather than showing an empty feed or — worse —
 * an invented one. It is also where the target user of this app (someone who
 * built a SaaS with an AI) tends to talk shop.
 */

const API = "https://hn.algolia.com/api/v1/search_by_date";
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
/** Long comments are cut here; relevance is judged on the opening, and prompts stay bounded. */
const MAX_TEXT_CHARS = 1_200;

interface Hit {
  objectID: string;
  author?: string | null;
  title?: string | null;
  story_title?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  created_at_i?: number;
}

type Fetch = typeof fetch;

export function hitToCandidate(hit: Hit): ConversationCandidate | null {
  const body = htmlToText(hit.comment_text ?? hit.story_text ?? "");
  const title = hit.title ?? null;
  const text = [title, body].filter(Boolean).join("\n\n").slice(0, MAX_TEXT_CHARS);
  if (!text.trim()) return null;
  return {
    source: "hackernews",
    externalId: hit.objectID,
    url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    author: hit.author ?? "unknown",
    text,
    postedAt: hit.created_at_i ? new Date(hit.created_at_i * 1000) : null,
  };
}

export function createHackerNewsSource(fetchImpl: Fetch = fetch, now: () => Date = () => new Date()): ConversationSource {
  return {
    name: "hackernews",
    available: () => true,

    async search(queries: string[], options: SearchOptions) {
      const since = Math.floor(now().getTime() / 1000) - options.sinceDays * 86_400;
      const perQuery = Math.max(5, Math.ceil(options.limit / Math.max(1, queries.length)));
      const seen = new Map<string, ConversationCandidate>();

      for (const query of queries) {
        const url = new URL(API);
        url.searchParams.set("query", query);
        url.searchParams.set("tags", "(story,comment)");
        url.searchParams.set("numericFilters", `created_at_i>${since}`);
        url.searchParams.set("hitsPerPage", String(perQuery));

        // One query failing (a timeout, a 5xx) costs that query, not the run.
        try {
          const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
          if (!response.ok) continue;
          const { text } = await readTextCapped(response, MAX_BYTES);
          const body = JSON.parse(text) as { hits?: Hit[] };
          for (const hit of body.hits ?? []) {
            const candidate = hitToCandidate(hit);
            if (candidate && !seen.has(candidate.externalId)) seen.set(candidate.externalId, candidate);
          }
        } catch {
          continue;
        }
        if (seen.size >= options.limit) break;
      }

      return [...seen.values()].slice(0, options.limit);
    },
  };
}
