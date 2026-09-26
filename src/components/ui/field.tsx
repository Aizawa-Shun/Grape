"use client";

import { useId, type ReactNode } from "react";

import { cx, focusRing } from "./cx";

/**
 * Hands the generated id to the control so the label cannot become detached.
 * Two of this app's three inputs had no label at all and the third's was never
 * associated; a render prop makes the wrong thing impossible rather than
 * merely discouraged.
 */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  className?: string;
  children: (props: { id: string; "aria-describedby": string | undefined }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      {children({ id, "aria-describedby": hintId })}
    </div>
  );
}

/** The shared look for text inputs and textareas, so Field's children stay one line. */
const controlBase = cx(
  "rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text",
  "placeholder:text-text-subtle disabled:opacity-50",
  focusRing,
);

export const controlClass = cx("w-full", controlBase);

/**
 * For a control that sits inside a sentence — "30日で 100人" — sized by the
 * caller. `controlClass` always fills its row, and a width class added after
 * it does not win against `w-full` (both are one utility; the stylesheet
 * order decides), so a sentence built from it broke onto four lines.
 */
export const inlineControlClass = controlBase;
