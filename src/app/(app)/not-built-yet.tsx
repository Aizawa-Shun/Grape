import Link from "next/link";

import { Callout } from "@/components/ui/callout";

/**
 * An honest destination for a menu item whose feature does not exist.
 *
 * Grape is one person on one machine: there is no user table, no plan and no
 * billing, so these pages cannot show anything real yet. Saying that plainly —
 * and saying what is true today instead — costs less trust than a page that
 * looks like it is loading something.
 */
export function NotBuiltYet({
  title,
  summary,
  planned,
  insteadHref,
  insteadLabel,
}: {
  title: string;
  summary: string;
  planned: string[];
  insteadHref?: string;
  insteadLabel?: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-text-muted">{summary}</p>
      </header>

      <Callout title="この画面はまだありません">
        <p>Grapeはいま、あなたのパソコンの中だけで動いています。ここに入る予定のものはこちらです。</p>
        <ul className="mt-2 list-inside list-disc">
          {planned.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Callout>

      {insteadHref && insteadLabel && (
        <p className="text-sm">
          <Link href={insteadHref} className="font-medium underline underline-offset-4">
            {insteadLabel} →
          </Link>
        </p>
      )}
    </div>
  );
}
