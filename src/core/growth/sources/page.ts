import { parseHtml, type ParsedPage } from "@/core/context/crawl";
import { publicOnlyPolicy, safeFetch, type Lookup } from "@/core/net/guard";
import { readTextCapped } from "@/core/net/read";

/**
 * Reads one public page — a competitor's homepage — with the same guard the
 * crawler uses, minus the crawler's one exemption: the crawler trusts the host
 * its user typed, and nobody typed this one. It came from a search result or
 * a model's memory, so it must resolve to a public address, every hop.
 *
 * Returns null instead of throwing: one competitor's site being down, slow or
 * refusing us should cost that competitor its "verified" mark, not the run.
 */

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 1024 * 1024;
const MAX_TEXT_CHARS = 6_000;

export interface PublicPage extends ParsedPage {
  url: string;
}

export async function fetchPublicPage(
  url: string,
  options: { fetchImpl?: typeof fetch; lookup?: Lookup } = {},
): Promise<PublicPage | null> {
  try {
    const { response, finalUrl } = await safeFetch(
      url,
      { headers: { "user-agent": "GrapeBot/1.0 (+growth research)", accept: "text/html" } },
      { policy: publicOnlyPolicy(options.lookup), timeoutMs: TIMEOUT_MS, fetchImpl: options.fetchImpl ?? fetch },
    );
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("html")) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const { text } = await readTextCapped(response, MAX_BYTES);
    const parsed = parseHtml(text, finalUrl, MAX_TEXT_CHARS);
    return parsed.text.trim() ? { ...parsed, url: finalUrl } : null;
  } catch {
    return null;
  }
}
