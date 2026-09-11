import type { SaasAnalysis } from "./analysis";
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
 * `UNSTATED` is preserved exactly for `unknown` claims, and not approximated
 * with "未確認" or anything else that reads the same to a person: site audit
 * compares against that literal by string equality (intelligence/audit.ts) to
 * decide whether a landing page states its value proposition at all. A
 * different-but-similar string there would silently pass every site.
 *
 * An `inferred` claim is written through as the plain answer. It is honest for
 * a prompt to say "個人開発者向け" when that was inferred — the model reading
 * it downstream is making a recommendation, not a factual record — and the
 * status, with its evidence, stays visible on the page where a person can
 * overrule it.
 */
export function contextFromAnalysis(analysis: SaasAnalysis): ProductContextExtraction {
  const { service } = analysis;

  return {
    what: textOf(service.what.value, service.what.status),
    who: textOf(service.who.value, service.who.status),
    // `why` is the reason to use this rather than the alternative, which the
    // analysis splits in two: the problem it addresses and the value it
    // claims to add. Joined rather than picking one, because a site that
    // states only one of them should still fill the field.
    why: listOf([...service.problems.items, ...service.valueProposition.items]),
    how: textOf(service.usage.value, service.usage.status),
    evidenceUrls: [...new Set(analysis.evidence.map((item) => item.url))],
    gaps: gapsFrom(analysis),
    primaryLanguage: analysis.primaryLanguage,
    // Reported for the row, not shown anywhere: nothing reads
    // product_contexts.confidence today. Kept truthful rather than dropped —
    // the share of the six headline claims the site actually stated.
    confidence: confidenceFrom(analysis),
  };
}

function textOf(value: string, status: SaasAnalysis["service"]["what"]["status"]): string {
  return status === "unknown" || value.trim().length === 0 ? UNSTATED : value.trim();
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
 * own value proposition.
 */
function gapsFrom(analysis: SaasAnalysis): string[] {
  const { service, business } = analysis;

  return [
    service.what.status === "unknown" ? "サイトが何をするサービスか明示していません" : null,
    service.who.status === "unknown" ? "サイトが誰向けか明示していません" : null,
    service.valueProposition.status === "unknown" ? "提供価値が明示されていません" : null,
    business.pricing.status === "unknown" ? "料金が明示されていません" : null,
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
