import { cx } from "./cx";

/**
 * The result of something the reader just did. Announced to screen readers,
 * which the previous bare `<p className="text-red-600">` was not — a failure
 * after a fifteen-second wait went completely unspoken.
 */
export function Status({
  tone = "info",
  className,
  children,
}: {
  tone?: "info" | "error";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={cx("text-xs", tone === "error" ? "text-negative" : "text-text-muted", className)}
    >
      {children}
    </p>
  );
}
