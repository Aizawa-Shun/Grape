import type { ActionChannel } from "../channel";

/**
 * The channel for anything a human does by hand — pasting copy into their own
 * landing page, editing a meta tag, sending an email themselves. Nothing here
 * calls out to the internet, so there is no cost to estimate and nothing for
 * the dry-run flag to gate: "sent" for this channel means "the human has the
 * text and can go do it", not "Grape published something automatically".
 */
export const manualChannel: ActionChannel = {
  name: "manual",

  estimateCostUsd() {
    return 0;
  },

  async execute() {
    return {
      externalUrl: null,
      response: { note: "manual channel — nothing was sent automatically; the artifact is meant to be used by hand." },
    };
  },
};
