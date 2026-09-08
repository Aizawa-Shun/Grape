/** Joins class names, dropping anything falsy. Too small to warrant a dependency. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Shared by every focusable primitive. The app previously set `outline-none`
 * on inputs with nothing in its place, which left keyboard users with no way
 * to see where they were.
 */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface";
