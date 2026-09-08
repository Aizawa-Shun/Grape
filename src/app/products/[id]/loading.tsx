/**
 * This page reads the funnel plus a handful of rows per task, which is fast
 * locally but not instant. Without this the browser keeps showing the previous
 * page, so following a link reads as a click that did nothing.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6 sm:py-16">
      <div className="flex flex-col gap-2">
        <div className="h-4 w-24 animate-pulse rounded bg-surface-sunken" />
        <div className="h-8 w-56 animate-pulse rounded bg-surface-sunken" />
      </div>
      <div className="h-36 animate-pulse rounded-md bg-surface-sunken" />
      <div className="h-48 animate-pulse rounded-md bg-surface-sunken" />
    </div>
  );
}
