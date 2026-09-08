import Link from "next/link";

import { Callout } from "@/components/ui/callout";
import { Page, PageHeader } from "@/components/ui/page";

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
    <Page>
      <PageHeader title={title} description={summary} />

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
    </Page>
  );
}
