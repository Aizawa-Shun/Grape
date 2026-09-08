import type { ButtonHTMLAttributes } from "react";

import { cx, focusRing } from "./cx";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg font-medium hover:opacity-90",
  secondary: "border border-border-strong text-text hover:bg-surface-sunken",
  ghost: "text-text-subtle hover:bg-surface-sunken hover:text-text",
  danger: "border border-negative text-negative hover:bg-negative hover:text-surface",
};

const SIZES: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-xs gap-1.5",
  md: "px-3.5 py-2 text-sm gap-2",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Disables the button, marks it busy, and shows a spinner beside the label. */
  loading?: boolean;
}

/**
 * Replaces five hand-copied button class strings that had drifted into three
 * different paddings. `loading` exists so that "disabled + aria-busy + a
 * spinner" cannot be half-implemented at one call site — every long action in
 * this app is an LLM call that can take a minute, and a button that only
 * greys out reads as broken.
 */
export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center rounded-md transition-opacity disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        focusRing,
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
