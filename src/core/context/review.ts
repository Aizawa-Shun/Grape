import type { SaasAnalysis } from "./analysis";
import { UNSTATED } from "./unstated";

export const REVIEW_FIELDS = ["what", "who", "why", "how"] as const;
export type ReviewField = (typeof REVIEW_FIELDS)[number];

export interface DraftFields {
  what: string;
  who: string;
  why: string;
  how: string;
}

/**
 * What the review screen should tell the reader about the draft it shows.
 *
 * - `blank`: the draft has nothing for the field — the rule-based reading
 *   (no model configured) could not find it, and stored `UNSTATED`. The
 *   field starts empty rather than showing the sentinel sentence.
 * - `guessed`: a model filled the field, but the site never said it; the
 *   analysis marked the claim `unknown`. Filled, and flagged, because an
 *   inference the reader has not been told about is one they will not check.
 *
 * `why` follows the claim it is labelled as on the screen (解決する課題 —
 * `service.problems`), not the value proposition it is joined with.
 */
export interface DraftNotes {
  source: "ai" | "rules" | "human";
  blank: ReviewField[];
  guessed: ReviewField[];
}

export function draftNotesFor(
  fields: DraftFields,
  analysis: SaasAnalysis | null,
  editedByHuman: boolean,
): DraftNotes {
  if (editedByHuman) return { source: "human", blank: [], guessed: [] };

  const blank = REVIEW_FIELDS.filter((field) => fields[field] === UNSTATED);
  if (!analysis) return { source: "rules", blank, guessed: [] };

  const { service } = analysis;
  const statusOf: Record<ReviewField, string> = {
    what: service.what.status,
    who: service.who.status,
    why: service.problems.status,
    how: service.usage.status,
  };
  const guessed = REVIEW_FIELDS.filter(
    (field) => !blank.includes(field) && statusOf[field] === "unknown",
  );
  return { source: "ai", blank, guessed };
}

/** The value a draft field should start with in an input — never the sentinel. */
export function editableValue(value: string): string {
  return value === UNSTATED ? "" : value;
}
