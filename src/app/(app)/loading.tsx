/**
 * The dashboard reads several tables per product, which is quick locally but
 * not instant. Without this the browser shows the previous page until it is
 * ready, which reads as a click that did nothing.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <div className="h-8 w-24 animate-pulse rounded-md bg-surface-sunken" />
      <div className="h-32 animate-pulse rounded-md bg-surface-sunken" />
      <div className="h-24 animate-pulse rounded-md bg-surface-sunken" />
    </div>
  );
}
