import type { SaasAnalysis } from "./analysis";
import {
  GAP_PRICING_UNSTATED,
  GAP_VALUE_UNSTATED,
  GAP_WHAT_UNSTATED,
  GAP_WHO_UNSTATED,
} from "./gaps";
import { UNSTATED } from "./extract";
import type { ProductContextExtraction } from "./extract";

/**
 * Turns a SaaS analysis back into the four-field Product Context.
 *
 * The analysis is what the product page shows; these four fields are what
 * every prompt downstream reasons over (see context/snapshot.ts, and the
 * diagnose / recommend / generate chain behind it). Deriving one from the
 * other, rather than having the model produce both, keeps them from drifting
 * apart — there is one reading of the site, rendered two ways.
 *
 * Every claim is written through as the plain answer now, whatever its
 * status. An `inferred` one always was: it is honest for a prompt to say
 * "個人開発者向け" when that was inferred — the model reading it downstream is
 * making a recommendation, not keeping a factual record — and the status, with
 * its evidence, stays visible on the page where a person can overrule it. An
 * `unknown` one joins it because the alternative was worse: it used to become
 * `UNSTATED`, which reached the reader as an empty field on a screen that
 * exists to tell them what Grape believes their product is. The model's best
 * reading of a site that never says who it is for is worth more than a blank,
 * and the snapshot every prompt gets already carries the caveat that none of
 * this has been confirmed by a human (see context/snapshot.ts).
 *
 * What that costs is a signal, and `gaps` is where it is paid back. "The site
 * never stated this" used to be inferable from the text itself equalling
 * `UNSTATED`; it is now said outright, in the literals of context/gaps.ts,
 * which intelligence/audit.ts reads to decide whether a landing page states
 * its own value proposition. `UNSTATED` survives below only as the defence
 * against a model that returns an empty string in spite of the schema.
 */
export function contextFromAnalysis(analysis: SaasAnalysis): ProductContextExtraction {
  const { service } = analysis;

  return {
    what: textOf(service.what.value),
    who: textOf(service.who.value),
    // `why` is the reason to use this rather than the alternative, which the
    // analysis splits in two: the problem it addresses and the value it
    // claims to add. Joined rather than picking one, because a site that
    // states only one of them should still fill the field.
    why: listOf([...service.problems.items, ...service.valueProposition.items]),
    how: textOf(service.usage.value),
    evidenceUrls: [...new Set(analysis.evidence.map((item) => item.url))],
    gaps: gapsFrom(analysis),
    primaryLanguage: analysis.primaryLanguage,
    // Reported for the row, not shown anywhere: nothing reads
    // product_contexts.confidence today. Kept truthful rather than dropped —
    // the share of the six headline claims the site actually stated.
    confidence: confidenceFrom(analysis),
  };
}

function textOf(value: string): string {
  const text = value.trim();
  return text.length === 0 ? UNSTATED : text;
}

function listOf(items: string[]): string {
  const kept = items.map((item) => item.trim()).filter(Boolean);
  return kept.length === 0 ? UNSTATED : kept.join("。");
}

/**
 * Only genuine unknowns, and only the four that matter to a reader.
 *
 * The old extraction filled `gaps` with an entry per unanswered question and
 * the product page gave the list its own box, which is exactly the "サイトに
 * 書かれていなかったこと" panel this redesign removes. What survives is the
 * part audit.ts quotes: a short account of what the site never said, for the
 * cold-start finding that tells an owner their landing page does not state its
 * own value proposition. Since the four text fields are now always filled,
 * this is the only place that record still exists — hence the shared literals
 * rather than sentences spelled out here (see context/gaps.ts).
 */
function gapsFrom(analysis: SaasAnalysis): string[] {
  const { service, business } = analysis;

  return [
    service.what.status === "unknown" ? GAP_WHAT_UNSTATED : null,
    service.who.status === "unknown" ? GAP_WHO_UNSTATED : null,
    service.valueProposition.status === "unknown" ? GAP_VALUE_UNSTATED : null,
    business.pricing.status === "unknown" ? GAP_PRICING_UNSTATED : null,
  ].filter((entry): entry is string => entry !== null);
}

function confidenceFrom(analysis: SaasAnalysis): number {
  const { service, business } = analysis;
  const statuses = [
    service.what.status,
    service.who.status,
    service.problems.status,
    service.valueProposition.status,
    service.features.status,
    business.pricing.status,
  ];

  // Confirmed counts fully, inferred half: a reading resting on inference is
  // a weaker claim about the site than one resting on its own sentences.
  const score = statuses.reduce(
    (total, status) => total + (status === "confirmed" ? 1 : status === "inferred" ? 0.5 : 0),
    0,
  );
  return Math.round((score / statuses.length) * 100) / 100;
}
