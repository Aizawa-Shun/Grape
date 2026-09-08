import type { Channel } from "@/db/schema";

import { estimateXPostCostUsd } from "./channels/x";

/**
 * Where a generated artifact actually goes. Mirrors the LLMProvider split in
 * core/llm/types.ts: everything above this interface (execute.ts) is written
 * against `ActionChannel`, so adding a new destination — email, Reddit,
 * whatever comes next — never touches the approval/dry-run gate that makes
 * this layer safe to build on.
 */
export interface ChannelExecutionResult {
  /** Where the published thing can be seen, if it produced a URL. */
  externalUrl: string | null;
  /** Raw response from the destination, kept for audit — see action_runs.response. */
  response: unknown;
}

export interface ActionChannel {
  readonly name: Channel;
  /** Estimated USD cost of sending this content, shown to the human before they approve. */
  estimateCostUsd(content: string): number;
  /** Actually sends the content. Only ever called after human approval and outside dry-run. */
  execute(content: string): Promise<ChannelExecutionResult>;
}

/**
 * Prices a piece of content without needing a working channel — i.e. without
 * credentials. This has to be independent of `getChannel()`: estimating cost
 * and showing it before approval is exactly the step that must work even when
 * the x channel is not configured yet, most obviously while dry-run is on and
 * nothing is really being sent (see execute.ts). Building a real ActionChannel
 * just to price a draft would make that impossible.
 */
export function estimateActionCostUsd(channel: Channel, content: string): number {
  return channel === "x" ? estimateXPostCostUsd(content) : 0;
}

/** Raised when a channel answers but the send did not go through. */
/** Missing credentials, the destination refusing the content, or not reaching it at all. */
export type ChannelFailure = "auth" | "rejected" | "network";

export class ChannelError extends Error {
  constructor(
    message: string,
    readonly channel: Channel,
    readonly failure: ChannelFailure,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ChannelError";
  }
}
