import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";
import { ASSESSMENT_MAX_SCORE, type ClaimStatus, type StatusTally } from "@/core/context/analysis";

/**
 * The smaller figures of the analysis report. Each is plain markup or SVG:
 * no client JavaScript, theme colours through CSS variables, and every number
 * also present as text so none of them depends on being seen.
 */

/** The overall score as a ring — the one figure the report leads with. */
export function ScoreRing({ score, label }: { score: number; label: string }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / ASSESSMENT_MAX_SCORE) * circumference;

  return (
    <figure className="flex flex-col items-center gap-1.5">
      <svg viewBox="0 0 128 128" className="size-32" role="img" aria-label={`${label} ${score.toFixed(1)} / ${ASSESSMENT_MAX_SCORE}`}>
        <circle cx={64} cy={64} r={radius} fill="none" stroke="var(--surface-sunken)" strokeWidth={12} />
        <circle
          cx={64}
          cy={64}
          r={radius}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          transform="rotate(-90 64 64)"
        />
        <text x={64} y={60} textAnchor="middle" dominantBaseline="central" fontSize={30} fontWeight={700} fill="var(--text)">
          {score.toFixed(1)}
        </text>
        <text x={64} y={86} textAnchor="middle" fontSize={12} fill="var(--text-muted)">
          / {ASSESSMENT_MAX_SCORE}
        </text>
      </svg>
      <figcaption className="text-xs text-text-muted">{label}</figcaption>
    </figure>
  );
}

const TALLY_UI: Record<ClaimStatus, { label: string; bar: string; note: string }> = {
  confirmed: { label: "確認済み", bar: "bg-accent", note: "サイトに書いてあった" },
  inferred: { label: "AI推定", bar: "bg-attention", note: "記述から導いた" },
  unknown: { label: "未確認", bar: "bg-border-strong", note: "判断できなかった" },
};

/**
 * How much of the report rests on the site's own words — one stacked bar
 * over every claim that carries a status. Read before anything else, it
 * tells the reader how far to lean on the rest of the page.
 */
export function StatusTallyBar({ tally }: { tally: StatusTally }) {
  const total = tally.confirmed + tally.inferred + tally.unknown;
  if (total === 0) return null;
  const order: ClaimStatus[] = ["confirmed", "inferred", "unknown"];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-text-muted">この分析の確度</span>
        <span className="text-xs text-text-subtle">{total}項目中</span>
      </div>
      <div aria-hidden="true" className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
        {order.map((status) =>
          tally[status] > 0 ? (
            <span
              key={status}
              className={TALLY_UI[status].bar}
              style={{ width: `${(tally[status] / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        {order.map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cx("size-2 rounded-full", TALLY_UI[status].bar)} />
            <span className="font-medium text-text">{TALLY_UI[status].label}</span>
            <span className="tabular-nums">{tally[status]}</span>
            <span className="text-text-subtle">（{TALLY_UI[status].note}）</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Numbered items — used wherever the order of a list is the reading order. */
function NumberedList({ items }: { items: string[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {items.map((item, index) => (
        <li key={`${index}-${item}`} className="flex gap-2.5 text-sm leading-relaxed">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[11px] font-semibold tabular-nums text-text-muted">
            {index + 1}
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ol>
  );
}

export interface ChainStep {
  title: string;
  caption: string;
  items: string[];
  badge: ReactNode;
  footer?: ReactNode;
}

/**
 * 課題 → 提供価値 → 機能, as the chain it is: what hurts, what the service
 * promises in return, and what it actually has that keeps the promise. Laid
 * out as three columns joined by arrows, because the relation between the
 * three lists is the point and three stacked lists hid it.
 */
export function ValueChain({ steps }: { steps: ChainStep[] }) {
  return (
    <ol className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-stretch lg:gap-2">
      {steps.map((step, index) => (
        <li key={step.title} className="contents">
          {index > 0 && (
            <span aria-hidden="true" className="flex items-center justify-center text-text-subtle">
              <svg viewBox="0 0 24 24" className="size-6 rotate-90 lg:rotate-0" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          )}
          <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-card">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  <span className="mr-1.5 text-text-subtle tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                  {step.title}
                </h3>
                {step.badge}
              </div>
              <p className="text-xs text-text-muted">{step.caption}</p>
            </div>
            <NumberedList items={step.items} />
            {step.footer}
          </div>
        </li>
      ))}
    </ol>
  );
}

interface SwotCell {
  letter: string;
  title: string;
  items: string[];
  tone: "plus" | "minus";
}

/**
 * The model's reading as a SWOT matrix: inside the service on the top row,
 * outside it on the bottom, helping on the left, hurting on the right. The
 * grid is the analysis — a strength means little until it is set against
 * the threat it answers — so the four lists are laid out where they can be
 * compared rather than one after another.
 */
export function SwotMatrix({
  strengths,
  weaknesses,
  opportunities,
  threats,
}: {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
}) {
  const cells: SwotCell[] = [
    { letter: "S", title: "強み", items: strengths, tone: "plus" },
    { letter: "W", title: "弱み", items: weaknesses, tone: "minus" },
    { letter: "O", title: "機会", items: opportunities, tone: "plus" },
    { letter: "T", title: "脅威", items: threats, tone: "minus" },
  ];

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr_1fr]">
      <span className="hidden sm:block" />
      <span className="hidden text-center text-xs font-medium text-text-muted sm:block">プラス要因</span>
      <span className="hidden text-center text-xs font-medium text-text-muted sm:block">マイナス要因</span>
      {[0, 1].map((row) => (
        <div key={row} className="contents">
          <span className="hidden items-center justify-center text-xs font-medium text-text-muted [writing-mode:vertical-rl] sm:flex">
            {row === 0 ? "内部" : "外部"}
          </span>
          {cells.slice(row * 2, row * 2 + 2).map((cell) => (
            <div
              key={cell.letter}
              className={cx(
                "relative flex flex-col gap-2.5 overflow-hidden rounded-md border p-4",
                cell.tone === "plus" ? "border-border bg-surface" : "border-border bg-surface-sunken",
              )}
            >
              <span
                aria-hidden="true"
                className={cx(
                  "pointer-events-none absolute -right-1 -top-3 text-7xl font-black opacity-10",
                  cell.tone === "plus" ? "text-positive" : "text-negative",
                )}
              >
                {cell.letter}
              </span>
              <h3 className="flex items-baseline gap-2 text-sm font-semibold">
                <span className={cell.tone === "plus" ? "text-positive" : "text-negative"}>{cell.letter}</span>
                {cell.title}
              </h3>
              {cell.items.length > 0 ? (
                <ul className="flex flex-col gap-1.5 text-sm leading-relaxed">
                  {cell.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span aria-hidden="true" className="text-text-subtle">
                        ·
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-text-subtle">この分析には含まれていません（サイトを読み直すと作られます）。</p>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
