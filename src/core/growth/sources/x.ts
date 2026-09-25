import { buildAuthHeader, xCredentialsFrom, type XCredentials } from "@/core/action/channels/x";
import { readTextCapped } from "@/core/net/read";
import { env, type Env } from "@/env";
import type { PostMetrics } from "@/db/schema";

import type { ConversationCandidate, ConversationSource, SearchOptions } from "./types";

/**
 * Reading X: recent search for conversations, and the numbers on our own posts.
 *
 * Two ways to authenticate, either is enough: an app-only bearer token
 * (X_BEARER_TOKEN), or the same OAuth 1.0a user credentials the posting
 * channel already uses. User context is preferred for metrics, because only
 * the author of a post can read its non-public counts (link clicks, profile
 * visits).
 *
 * Reads are metered since X's Feb 2026 pricing, so every search is capped at
 * X_SEARCH_MAX_RESULTS and made once per run as a single OR-query rather than
 * once per keyword.
 */

const SEARCH_URL = "https://api.x.com/2/tweets/search/recent";
const LOOKUP_URL = "https://api.x.com/2/tweets";
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 2 * 1024 * 1024;
/** Recent search's own limit on the query string. */
const MAX_QUERY_CHARS = 512;

interface XAuth {
  bearer: string | null;
  user: XCredentials | null;
}

export function xReadAuth(source: Pick<Env, "X_BEARER_TOKEN" | "X_CONSUMER_KEY" | "X_CONSUMER_SECRET" | "X_ACCESS_TOKEN" | "X_ACCESS_TOKEN_SECRET"> = env): XAuth | null {
  const bearer = source.X_BEARER_TOKEN?.trim() || null;
  const user = xCredentialsFrom(source);
  return bearer || user ? { bearer, user } : null;
}

function authHeader(auth: XAuth, url: string, params: Record<string, string>, preferUser: boolean): string {
  if (auth.user && (preferUser || !auth.bearer)) return buildAuthHeader("GET", url, auth.user, params);
  return `Bearer ${auth.bearer}`;
}

async function getJson(auth: XAuth, base: string, params: Record<string, string>, preferUser = false, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetchImpl(url, {
    headers: { Authorization: authHeader(auth, base, params, preferUser) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const { text } = await readTextCapped(response, MAX_BYTES);
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const detail = (body as { detail?: string; title?: string } | null)?.detail ?? `HTTP ${response.status}`;
    throw new Error(`X API ${response.status}: ${detail}`);
  }
  return body;
}

/**
 * One OR-query from many phrases, quoted where they contain a space, cut to
 * what fits. Retweets are dropped (the same words, twice) and so are our own
 * kind of noise: links-only promo posts rarely ask anything.
 */
export function buildXQuery(phrases: string[], language?: string): string {
  const suffix = ` -is:retweet${language ? ` lang:${language.split("-")[0]}` : ""}`;
  const terms: string[] = [];
  let length = suffix.length + 2;
  for (const raw of phrases) {
    const phrase = raw.replace(/["()]/g, "").trim();
    if (!phrase) continue;
    const term = /\s/.test(phrase) ? `"${phrase}"` : phrase;
    const added = term.length + (terms.length > 0 ? 4 : 0);
    if (length + added > MAX_QUERY_CHARS) break;
    terms.push(term);
    length += added;
  }
  return terms.length > 0 ? `(${terms.join(" OR ")})${suffix}` : "";
}

interface SearchBody {
  data?: { id: string; text: string; author_id?: string; created_at?: string }[];
  includes?: { users?: { id: string; username: string }[] };
}

export function createXSource(
  auth: XAuth | null = xReadAuth(),
  maxResults: number = env.X_SEARCH_MAX_RESULTS,
  fetchImpl: typeof fetch = fetch,
): ConversationSource {
  return {
    name: "x",
    available: () => auth !== null,

    async search(queries: string[], options: SearchOptions): Promise<ConversationCandidate[]> {
      if (!auth) return [];
      const query = buildXQuery(queries, options.language);
      if (!query) return [];

      const since = new Date(Date.now() - Math.min(options.sinceDays, 7) * 86_400_000);
      const body = (await getJson(
        auth,
        SEARCH_URL,
        {
          query,
          max_results: String(Math.min(maxResults, Math.max(10, options.limit))),
          start_time: since.toISOString(),
          "tweet.fields": "created_at,author_id,lang",
          expansions: "author_id",
          "user.fields": "username",
        },
        false,
        fetchImpl,
      )) as SearchBody;

      const names = new Map((body.includes?.users ?? []).map((user) => [user.id, user.username]));
      return (body.data ?? []).map((tweet) => {
        const username = tweet.author_id ? names.get(tweet.author_id) : undefined;
        return {
          source: "x" as const,
          externalId: tweet.id,
          url: username ? `https://x.com/${username}/status/${tweet.id}` : `https://x.com/i/status/${tweet.id}`,
          author: username ? `@${username}` : "unknown",
          text: tweet.text,
          postedAt: tweet.created_at ? new Date(tweet.created_at) : null,
        };
      });
    },
  };
}

interface LookupBody {
  data?: {
    id: string;
    public_metrics?: {
      impression_count?: number;
      like_count?: number;
      reply_count?: number;
      retweet_count?: number;
      quote_count?: number;
      bookmark_count?: number;
    };
    non_public_metrics?: { url_link_clicks?: number; user_profile_clicks?: number };
  }[];
}

/**
 * The counts X has for posts we published, by id. Non-public counts are only
 * readable by the author and only for recent posts; when X refuses them the
 * public ones are asked for alone rather than giving up on both.
 */
export async function fetchXMetrics(
  ids: string[],
  auth: XAuth | null = xReadAuth(),
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, PostMetrics>> {
  const result = new Map<string, PostMetrics>();
  if (!auth || ids.length === 0) return result;

  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    let body: LookupBody;
    try {
      body = (await getJson(
        auth,
        LOOKUP_URL,
        { ids: batch.join(","), "tweet.fields": auth.user ? "public_metrics,non_public_metrics" : "public_metrics" },
        true,
        fetchImpl,
      )) as LookupBody;
    } catch {
      body = (await getJson(auth, LOOKUP_URL, { ids: batch.join(","), "tweet.fields": "public_metrics" }, true, fetchImpl)) as LookupBody;
    }

    for (const tweet of body.data ?? []) {
      const pub = tweet.public_metrics ?? {};
      const priv = tweet.non_public_metrics ?? {};
      result.set(tweet.id, {
        impressions: pub.impression_count ?? null,
        likes: pub.like_count ?? null,
        replies: pub.reply_count ?? null,
        reposts: pub.retweet_count ?? null,
        quotes: pub.quote_count ?? null,
        bookmarks: pub.bookmark_count ?? null,
        profileVisits: priv.user_profile_clicks ?? null,
        linkClicks: priv.url_link_clicks ?? null,
        source: "x_api",
      });
    }
  }

  return result;
}
