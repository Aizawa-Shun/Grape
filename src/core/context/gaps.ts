/**
 * What a `gaps` entry reads when the site never stated something.
 *
 * Its own module, with no imports, for the same reason `unstated.ts` is one:
 * these strings are written by context/derive.ts and read back by
 * intelligence/audit.ts, which decides from them whether a landing page states
 * its own value proposition at all. Two files each spelling the sentence their
 * own way would make that check silently pass every site.
 *
 * They carry the weight `UNSTATED` used to carry alone. An analysis now fills
 * every field — a site that never says who it is for gets the model's best
 * reading of who it is for, marked `unknown` and visibly so — which means the
 * four stored text fields are no longer where "the site did not say this"
 * lives. It lives here.
 */

export const GAP_WHAT_UNSTATED = "サイトが何をするサービスか明示していない";
export const GAP_WHO_UNSTATED = "サイトが誰向けか明示していない";
export const GAP_VALUE_UNSTATED = "提供価値が明示されていない";
export const GAP_PRICING_UNSTATED = "料金が明示されていない";
