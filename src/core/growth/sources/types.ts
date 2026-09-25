import type { OpportunitySource } from "@/db/schema";

/**
 * A public post that might be a person who needs the product — before anyone
 * has judged whether it is. Every field here was read from the source; the
 * judgment (relevance, reasons) is added afterwards by OpportunityFinder.
 */
export interface ConversationCandidate {
  source: OpportunitySource;
  externalId: string;
  url: string;
  author: string;
  text: string;
  postedAt: Date | null;
}

export interface SearchOptions {
  /** Only posts newer than this many days. */
  sinceDays: number;
  /** Upper bound on candidates returned, across all queries. */
  limit: number;
  /** BCP-47 code of the audience's language, when the source can filter by it. */
  language?: string;
}

/**
 * Where conversations are looked for. `available` is synchronous and cheap —
 * it only says whether credentials exist — so the orchestrator can list which
 * sources a run will use before spending anything.
 */
export interface ConversationSource {
  readonly name: OpportunitySource;
  available(): boolean;
  search(queries: string[], options: SearchOptions): Promise<ConversationCandidate[]>;
}

/** Strips tags and decodes the handful of entities these APIs actually send. */
export function htmlToText(html: string): string {
  return html
    .replace(/<p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, "/")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
