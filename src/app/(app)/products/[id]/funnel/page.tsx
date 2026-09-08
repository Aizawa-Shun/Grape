import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Callout } from "@/components/ui/callout";
import { getFunnel } from "@/core/data/funnel";
import { db, schema } from "@/db/client";

import { FunnelView } from "../funnel-view";

const WINDOW_CHOICES = [7, 30, 90] as const;

function parseWindowDays(raw: string | undefined): number {
  const n = Number(raw);
  return (WINDOW_CHOICES as readonly number[]).includes(n) ? n : 30;
}

/**
 * Current state only. No tasks here, on purpose: this page is for looking at
 * what is true, and a to-do list next to it turns every glance into a decision.
 */
export default async function FunnelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ windowDays?: string }>;
}) {
  const { id } = await params;
  const { windowDays: windowDaysParam } = await searchParams;
  const windowDays = parseWindowDays(windowDaysParam);

  const product = await db.query.products.findFirst({ where: eq(schema.products.id, id) });
  if (!product) notFound();

  const funnel = await getFunnel(id, { windowDays });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">利用者の流れ</h1>
        <p className="text-sm text-text-muted">
          サイトに来た人が、どこまで進んで、どこで離れているか。
        </p>
      </header>

      {!product.keyEventName && (
        <Callout tone="attention">
          「ここまで来たら使ってもらえた」と言える操作をまだ決めていないので、
          後半の2つは数えられません。{" "}
          <Link href="/settings" className="font-medium underline underline-offset-2">
            設定で決める
          </Link>
        </Callout>
      )}

      <FunnelView productId={id} funnel={funnel} windowDays={windowDays} />
    </div>
  );
}
