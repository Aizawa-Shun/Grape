import type { ReactNode } from "react";

import { cx } from "./cx";

/**
 * The reading column, defined once.
 *
 * Six pages had each hand-rolled this wrapper and drifted apart — three
 * vertical paddings, three gaps and two heading sizes between them — so the
 * layout visibly shifted every time you moved between them. A page now says
 * what it contains, not how wide it is.
 */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * `actions` sits on the title's baseline rather than under it, so a page-level
 * control never pushes the content down a row when the title wraps.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * A titled group. The heading stays quiet on purpose: on every screen here the
 * content carries the message and the label only says where you are.
 */
export function Section({
  id,
  title,
  description,
  actions,
  children,
  className,
}: {
  /** Kept, because the briefing links straight to #register on the home page. */
  id?: string;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cx("flex flex-col gap-3", className)}>
      {(title ?? actions) != null && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title && <h2 className="text-sm font-medium text-text">{title}</h2>}
            {description && <p className="text-xs text-text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
