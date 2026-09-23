import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { cx } from "@/components/ui/cx";
import {
  ASSESSMENT_AXES,
  ASSESSMENT_MAX_SCORE,
  assessmentRows,
  overallScore,
  weakestAxisKey,
  type SaasAssessment,
} from "@/core/context/analysis";

/**
 * Where this product stands today, on the six things a site can be judged on.
 *
 * A bar chart because the reader's job here is to compare magnitudes across a
 * handful of named categories and find the low one — the case bars are for.
 * Not a radar: six axes on a polygon make area, not length, the thing the eye
 * measures, and area exaggerates the difference between a 3 and a 4 while
 * hiding which axis is which behind rotated labels.
 *
 * One colour for every bar, never a ramp by value. Shading each bar
 * darker-where-bigger would encode the score twice — once as length, once as
 * hue — and spend the only channel left on nothing. What the colour does carry
 * is emphasis: the single weakest axis is drawn in the attention colour and
 * says 最優先 in words beside it, so the point survives a reader who cannot
 * separate the two hues.
 *
 * The numbers are a column, not labels floating on the marks: every score is
 * readable as text, which is also what makes the chart usable without seeing
 * it at all. No tooltip layer, deliberately — a hover would have nothing to
 * reveal that the comment under each bar is not already saying out loud.
 *
 * Colour check (dataviz validator, both surfaces): accent↔attention separate
 * at ΔE 30.2 light / 21.4 dark under every CVD simulation, ΔE 37.6 / 22.1 for
 * normal vision, and both clear 3:1 against their surface. The lightness-band
 * and chroma checks are categorical-palette rules and do not apply to a
 * one-series chart whose second colour is a status.
 */

const SCALE_STEPS = [1, 2, 3, 4, 5];

/** 1–5 in words, so the bar is never the only thing carrying the level. */
const SCORE_WORDS = ["", "ほぼ手つかず", "弱い", "ふつう", "よくできている", "言うことがない"];

function Bar({ score, emphasised }: { score: number; emphasised: boolean }) {
  return (
    // The track is the scale: gridlines sit on it at each step, hairline and
    // one step off the surface, so a 4 and a 5 can be told apart by where they
    // stop rather than by reading the number twice.
    <div
      aria-hidden="true"
      className="relative h-2 w-full overflow-hidden rounded-sm bg-surface-sunken"
    >
      {SCALE_STEPS.slice(0, -1).map((step) => (
        <span
          key={step}
          className="absolute inset-y-0 w-px bg-border"
          style={{ left: `${(step / ASSESSMENT_MAX_SCORE) * 100}%` }}
        />
      ))}
      {/* Square where it leaves the baseline, 4px rounded at the data end. */}
      <span
        className={cx(
          "absolute inset-y-0 left-0 rounded-r-[4px]",
          emphasised ? "bg-attention" : "bg-accent",
        )}
        style={{ width: `${(score / ASSESSMENT_MAX_SCORE) * 100}%` }}
      />
    </div>
  );
}

export function AssessmentChart({ assessment }: { assessment: SaasAssessment }) {
  const rows = assessmentRows(assessment);
  const weakest = weakestAxisKey(assessment);
  const overall = overallScore(assessment);

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          {/* Proportional figures, not tabular: this one stands alone, and
              tabular-nums only earns its keep in the column below. */}
          <span className="text-2xl font-semibold">{overall.toFixed(1)}</span>
          <span className="text-sm text-text-muted">/ {ASSESSMENT_MAX_SCORE}</span>
        </div>
        <p className="text-xs text-text-muted">
          サイトから読み取れた範囲での採点。低い軸ほど、いま手を入れて効く。
        </p>
      </div>

      <dl className="flex flex-col divide-y divide-border">
        {rows.map((row) => {
          const emphasised = row.key === weakest;

          return (
            <div key={row.key} className="grid gap-1.5 py-3 first:pt-0 last:pb-0 sm:grid-cols-[10rem_1fr] sm:gap-4">
              <dt className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                {row.label}
                {emphasised && <Badge tone="attention">最優先</Badge>}
              </dt>
              <dd className="flex flex-col gap-1.5">
                <div className="flex items-center gap-3">
                  <Bar score={row.score} emphasised={emphasised} />
                  <span className="flex shrink-0 items-baseline gap-1.5">
                    <span className="text-sm font-medium tabular-nums">{row.score}</span>
                    <span className="text-xs text-text-muted">{SCORE_WORDS[row.score]}</span>
                  </span>
                </div>
                <p className="text-sm leading-relaxed">{row.comment}</p>
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-sm leading-relaxed">{assessment.summary}</p>
        <p className="text-sm leading-relaxed">
          <span className="text-text-muted">最初に手を入れるなら: </span>
          {assessment.priority}
        </p>
      </div>

      {/*
        What each axis actually asks, one click away rather than a second line
        of small print under all six labels — the same treatment evidence gets
        on this page, and for the same reason.
      */}
      <Disclosure summary="採点の見方">
        <ul className="flex flex-col gap-1 text-xs text-text-muted">
          {/*
            Label and question in one line of text rather than a two-column
            list: this is a footnote read once, and a grid here only recreated
            the row layout above it at a smaller size.
          */}
          {ASSESSMENT_AXES.map((axis) => (
            <li key={axis.key}>{`${axis.label} — ${axis.question}`}</li>
          ))}
          <li>{`点数 — 1=${SCORE_WORDS[1]} / 3=${SCORE_WORDS[3]} / 5=${SCORE_WORDS[5]}`}</li>
        </ul>
      </Disclosure>
    </Card>
  );
}
