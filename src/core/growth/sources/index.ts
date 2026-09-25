import { createHackerNewsSource } from "./hackernews";
import type { ConversationSource } from "./types";
import { createXSource } from "./x";

export * from "./types";
export { createHackerNewsSource } from "./hackernews";
export { createXSource, fetchXMetrics, xReadAuth, buildXQuery } from "./x";
export { getWebResearcher, type WebResearcher, type WebResearchResult } from "./web";

/**
 * The conversation sources a run can search, in the order they are tried.
 * The web is not here: it is searched through the WebResearcher, which
 * returns quoted passages rather than posts with ids (see agents/opportunity-finder.ts).
 */
export function conversationSources(): ConversationSource[] {
  return [createXSource(), createHackerNewsSource()];
}
