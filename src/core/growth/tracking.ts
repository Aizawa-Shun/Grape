import type { OpportunitySource } from "@/db/schema";

import { GROWTH_UTM_CAMPAIGN } from "./attribution";

/**
 * The product link a growth post carries, tagged so the tracking snippet can
 * tell which post a visit came from (attribution.ts reads utm_content back).
 */
export function trackingUrl(productUrl: string, postId: string, source: OpportunitySource | "x" = "x"): string {
  const url = new URL(productUrl);
  url.searchParams.set("utm_source", source);
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", GROWTH_UTM_CAMPAIGN);
  url.searchParams.set("utm_content", postId);
  return url.toString();
}

/**
 * X's web intent: opens the composer with the text filled in (and the reply
 * target, for a reply). The path that works with no API credentials at all —
 * the person presses Post themselves.
 */
export function xIntentUrl(text: string, inReplyTo: string | null): string {
  const url = new URL("https://x.com/intent/post");
  url.searchParams.set("text", text);
  if (inReplyTo) url.searchParams.set("in_reply_to", inReplyTo);
  return url.toString();
}

/** The status id out of an x.com / twitter.com post URL, or null. */
export function xStatusId(url: string): string | null {
  const match = url.match(/(?:x|twitter)\.com\/(?:[^/]+|i)\/status(?:es)?\/(\d+)/i);
  return match ? match[1] : null;
}
