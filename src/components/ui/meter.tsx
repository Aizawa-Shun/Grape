import { cx } from "./cx";

/**
 * Five dots read "●●●○○", which is a number the reader has to count, and which
 * reached a screen reader as a run of punctuation. A short bar with the value
 * spelled out beside it is taken in at a glance and can actually be announced.
 *
 * Renders a dt/dd pair, so it belongs inside a <dl> — the ratings it shows are
 * a term and its value, and the surrounding card already had them as one.
 */
const WORDS = ["", "とても小さい", "小さい", "ふつう", "大きい", "とても大きい"] as const;

export function Meter({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  /** 1–5; anything outside is clamped rather than drawn wrong. */
  value: number;
  tone?: "neutral" | "attention";
}) {
  const filled = Math.min(Math.max(Math.round(value), 1), 5);

  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="flex items-center gap-1.5">
        <span aria-hidden="true" className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map((step) => (
            <span
              key={step}
              className={cx(
                "h-1.5 w-3.5 rounded-full",
                step > filled
                  ? "bg-border"
                  : tone === "attention"
                    ? "bg-attention"
                    : "bg-accent",
              )}
            />
          ))}
        </span>
        <span className="text-xs text-text">{WORDS[filled]}</span>
      </dd>
    </div>
  );
}
