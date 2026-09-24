import type { ArtifactKind, Channel } from "@/db/schema";

/**
 * What each channel may produce, default first.
 *
 * `x` publishes a post and nothing else can go out that way. `manual` is copy
 * a person uses themselves, and a manual task is as likely to mean "fix the
 * search snippet" or "write to the people who signed up" as "rewrite the
 * landing page" — so it offers all three, and the reader picks.
 *
 * Its own module, importing only types, so the task card (a client
 * component) can offer the same choices generate.ts enforces without pulling
 * the database client into the browser bundle.
 */
export const CHANNEL_ARTIFACT_KINDS: Record<Channel, readonly ArtifactKind[]> = {
  x: ["x_post"],
  manual: ["lp_copy", "meta", "email"],
};

/** What each kind is called on screen. */
export const ARTIFACT_KIND_LABELS: Record<ArtifactKind, string> = {
  x_post: "Xの投稿",
  lp_copy: "サイトに載せる文章",
  meta: "検索結果に出るタイトルと説明文",
  email: "メール",
};
