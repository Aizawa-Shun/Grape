import type { MarketPositioning } from "@/core/context/analysis";

/**
 * This service among the similar ones, on the two axes the model found they
 * spread out on.
 *
 * A scatter because the question the reader brings to a market section is
 * "where am I, and where is nobody" — a question about position in two
 * dimensions that a list of names cannot answer at all.
 *
 * The other services are numbered markers rather than name labels on the
 * plot: names collide the moment two services sit close together, which is
 * exactly the case worth seeing. The numbers key into the list beside the
 * map, which also carries each one's difference in words, so the chart is
 * readable as text without seeing it. This service is the one filled mark,
 * in the attention colour, and says so in words.
 *
 * Plain SVG in a viewBox: it scales with its column, needs no client
 * JavaScript, and reads the theme's CSS variables so it follows dark mode.
 */

// Narrow on purpose: the map is drawn at ~330px on a phone and ~500px beside
// its list on a desktop, and a narrower viewBox keeps the labels readable at
// the small end without growing past body text at the large one.
const W = 440;
const H = 364;
const PAD = { left: 20, right: 20, top: 36, bottom: 66 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const STEPS = [1, 2, 3, 4, 5];

const px = (value: number) => PAD.left + ((value - 1) / 4) * PLOT_W;
const py = (value: number) => PAD.top + (1 - (value - 1) / 4) * PLOT_H;

interface Placed {
  x: number;
  y: number;
}

/**
 * Nudges markers apart that the model put on (nearly) the same spot, so two
 * services never hide one under the other. Deterministic — same input, same
 * picture — and small enough not to misstate where anything sits.
 */
function separate(points: Placed[], minDistance = 30): Placed[] {
  const placed: Placed[] = [];
  for (const point of points) {
    let { x, y } = point;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const clash = placed.find((other) => Math.hypot(other.x - x, other.y - y) < minDistance);
      if (!clash) break;
      const angle = (attempt / 8) * Math.PI * 2 + Math.PI / 4;
      x = point.x + Math.cos(angle) * minDistance;
      y = point.y + Math.sin(angle) * minDistance;
    }
    placed.push({ x, y });
  }
  return placed;
}

export function PositioningMap({ positioning }: { positioning: MarketPositioning }) {
  const { xAxis, yAxis, self, others } = positioning;

  const [selfAt, ...othersAt] = separate([
    { x: px(self.x), y: py(self.y) },
    ...others.map((other) => ({ x: px(other.x), y: py(other.y) })),
  ]);
  // The label goes on whichever side has room.
  const selfLabelLeft = selfAt.x > W - 130;

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-6">
      <figure className="flex flex-col gap-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`位置づけの図。横軸は${xAxis.label}（${xAxis.low}〜${xAxis.high}）、縦軸は${yAxis.label}（${yAxis.low}〜${yAxis.high}）。`}
          className="h-auto w-full"
        >
          <rect
            x={PAD.left}
            y={PAD.top}
            width={PLOT_W}
            height={PLOT_H}
            rx={8}
            fill="var(--surface-sunken)"
            stroke="var(--border)"
          />
          {STEPS.slice(1, -1).map((step) => (
            <g key={step}>
              <line
                x1={px(step)}
                x2={px(step)}
                y1={PAD.top}
                y2={PAD.top + PLOT_H}
                stroke="var(--border)"
                strokeDasharray={step === 3 ? undefined : "2 4"}
                strokeWidth={step === 3 ? 1.5 : 1}
              />
              <line
                x1={PAD.left}
                x2={PAD.left + PLOT_W}
                y1={py(step)}
                y2={py(step)}
                stroke="var(--border)"
                strokeDasharray={step === 3 ? undefined : "2 4"}
                strokeWidth={step === 3 ? 1.5 : 1}
              />
            </g>
          ))}

          {/* Axis ends, in words, all outside the plot so no marker can
              cover one: the vertical axis's ends above and just below it, the
              horizontal axis's on the row beneath. */}
          <g fontSize={13} fill="var(--text-muted)">
            <text x={PAD.left} y={H - 14}>
              ← {xAxis.low}
            </text>
            <text x={W - PAD.right} y={H - 14} textAnchor="end">
              {xAxis.high} →
            </text>
            <text x={W / 2} y={H - 14} textAnchor="middle" fontWeight={600} fill="var(--text)">
              {xAxis.label}
            </text>
            <text x={PAD.left} y={PAD.top - 12}>
              ↑ {yAxis.high}
            </text>
            <text x={PAD.left} y={PAD.top + PLOT_H + 20}>
              ↓ {yAxis.low}
            </text>
            <text
              x={W - PAD.right}
              y={PAD.top - 12}
              textAnchor="end"
              fontWeight={600}
              fill="var(--text)"
            >
              縦: {yAxis.label}
            </text>
          </g>

          {othersAt.map((at, index) => (
            <g key={`${others[index].name}-${index}`}>
              <circle cx={at.x} cy={at.y} r={14} fill="var(--surface)" stroke="var(--text-muted)" strokeWidth={1.5} />
              <text
                x={at.x}
                y={at.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={13}
                fontWeight={600}
                fill="var(--text)"
              >
                {index + 1}
              </text>
            </g>
          ))}

          <g>
            <circle cx={selfAt.x} cy={selfAt.y} r={24} fill="var(--attention)" opacity={0.15} />
            <circle cx={selfAt.x} cy={selfAt.y} r={11} fill="var(--attention)" />
            <text
              x={selfLabelLeft ? selfAt.x - 30 : selfAt.x + 30}
              y={selfAt.y}
              textAnchor={selfLabelLeft ? "end" : "start"}
              dominantBaseline="central"
              fontSize={14}
              fontWeight={700}
              fill="var(--attention)"
            >
              このサービス
            </text>
          </g>
        </svg>
      </figure>

      <div className="flex flex-col gap-3">
        <ol className="flex flex-col gap-2.5">
          {others.map((other, index) => (
            <li key={`${other.name}-${index}`} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-full border border-text-muted text-xs font-semibold"
              >
                {index + 1}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{other.name}</span>
                <span className="text-xs leading-relaxed text-text-muted">{other.note}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="rounded-md border border-attention-border bg-attention-bg px-3 py-2.5 text-sm leading-relaxed">
          {positioning.takeaway}
        </p>
      </div>
    </div>
  );
}
