import type { ButtonHTMLAttributes } from "react";

import { cx, focusRing } from "./cx";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  // shadow-sm only on the two variants meant to look pressable from across
  // the room — a bordered secondary/ghost button already reads as one.
  primary: "bg-accent text-accent-fg font-medium shadow-sm hover:opacity-90",
  secondary: "border border-border-strong text-text hover:border-text-subtle hover:bg-surface-sunken",
  ghost: "text-text-subtle hover:bg-surface-sunken hover:text-text",
  danger: "border border-negative text-negative shadow-sm hover:bg-negative hover:text-surface",
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
 * The class string alone, for the one caller that cannot be a `<button>`:
 * "Sign in with Google" is a plain top-level navigation to /api/auth/google,
 * which a client-side click handler cannot replace — the browser has to
 * actually leave the page and follow Google's redirect chain. An `<a>` styled
 * to match is simpler than teaching Button to render as one.
 */
export function buttonClassName(
  variant: Variant = "secondary",
  size: Size = "md",
  className?: string,
): string {
  return cx(
    // `active:scale` is the one purely cosmetic addition here — a button
    // that only changes colour on press reads as flat under a cursor
    // that is visibly pushing it. Every other change on this line
    // (colour, border, shadow) was already conditional on some state.
    "inline-flex items-center justify-center rounded-md transition-[color,background-color,border-color,box-shadow,opacity,scale] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
    VARIANTS[variant],
    SIZES[size],
    focusRing,
    className,
  );
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
      className={buttonClassName(variant, size, className)}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
