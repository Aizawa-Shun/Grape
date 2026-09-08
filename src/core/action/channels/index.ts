import { env } from "@/env";
import type { Channel } from "@/db/schema";

import type { ActionChannel } from "../channel";
import { manualChannel } from "./manual";
import { createXChannel } from "./x";

export { manualChannel } from "./manual";
export { createXChannel, estimateXPostCostUsd, X_POST_MAX_CHARS, type XCredentials } from "./x";

/**
 * The one place execute.ts acquires a channel — mirrors core/llm/index.ts's
 * getProvider(). Credentials are read from env here, not passed around, so
 * nothing above this needs to know X uses OAuth 1.0a versus some other
 * scheme.
 */
export function getChannel(name: Channel): ActionChannel {
  switch (name) {
    case "manual":
      return manualChannel;
    case "x": {
      const { X_CONSUMER_KEY, X_CONSUMER_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET } = env;
      if (!X_CONSUMER_KEY || !X_CONSUMER_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) {
        throw new Error(
          "X channel is not configured — set X_CONSUMER_KEY, X_CONSUMER_SECRET, X_ACCESS_TOKEN and X_ACCESS_TOKEN_SECRET",
        );
      }
      return createXChannel({
        consumerKey: X_CONSUMER_KEY,
        consumerSecret: X_CONSUMER_SECRET,
        accessToken: X_ACCESS_TOKEN,
        accessTokenSecret: X_ACCESS_TOKEN_SECRET,
      });
    }
  }
}
