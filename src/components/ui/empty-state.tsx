import type { ReactNode } from "react";

/**
 * What a screen shows before it has anything to show.
 *
 * The funnel at cold start used to put a two-line notice at the top of an
 * otherwise blank 900px viewport, which reads as a page that failed to load
 * rather than one that is waiting for data. `preview` is the fix: a dimmed
 * sketch of the real thing, so the shape of what is coming is legible on day
 * one and the space is doing work.
 */
export function EmptyState({
  title,
  body,
  action,
  preview,
}: {
  title: string;
  body: ReactNode;
  action?: ReactNode;
  preview?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 rounded-md border border-dashed border-border-strong bg-surface-sunken/50 px-5 py-6">
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">{title}</p>
        <div className="text-sm text-text-muted">{body}</div>
        {action && <div className="mt-1.5">{action}</div>}
      </div>
      {preview && (
        <div aria-hidden="true" className="select-none opacity-40">
          {preview}
        </div>
      )}
    </div>
  );
}
