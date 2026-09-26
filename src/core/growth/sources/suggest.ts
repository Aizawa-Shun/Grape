import { readTextCapped } from "@/core/net/read";

/**
 * What people actually type into a search box, from Google's suggestions.
 *
 * The one keyless view of search demand there is. It is not volume — nothing
 * here says how many people search for a phrase — only that people do, and in
 * which words. That is what a post needs (the phrase to use), and it is shown
 * as exactly that, never as a "demand score".
 *
 * An unofficial endpoint that several tools rely on; it may change or refuse,
 * so a failure is an empty answer and the run carries on without it.
 */

export interface SuggestSource {
  suggest(query: string, language: string): Promise<string[]>;
}

const ENDPOINT = "https://suggestqueries.google.com/complete/search";
const TIMEOUT_MS = 6_000;
const MAX_BYTES = 64 * 1024;

export function createSuggestSource(fetchImpl: typeof fetch = fetch): SuggestSource {
  return {
    async suggest(query, language) {
      try {
        const url = new URL(ENDPOINT);
        url.searchParams.set("client", "firefox");
        url.searchParams.set("hl", language.split("-")[0] || "en");
        url.searchParams.set("q", query);
        const response = await fetchImpl(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!response.ok) return [];
        const { text } = await readTextCapped(response, MAX_BYTES);
        const body = JSON.parse(text) as unknown;
        const list = Array.isArray(body) && Array.isArray(body[1]) ? (body[1] as unknown[]) : [];
        return list.filter((item): item is string => typeof item === "string");
      } catch {
        return [];
      }
    },
  };
}

/** Suggestions worth keeping: not the query itself, not near-empty, no duplicates. */
export function cleanSuggestions(query: string, suggestions: string[], max = 8): string[] {
  const seen = new Set<string>([query.trim().toLowerCase()]);
  const kept: string[] = [];
  for (const raw of suggestions) {
    const suggestion = raw.trim();
    const key = suggestion.toLowerCase();
    if (suggestion.length < 3 || seen.has(key)) continue;
    seen.add(key);
    kept.push(suggestion);
    if (kept.length >= max) break;
  }
  return kept;
}
