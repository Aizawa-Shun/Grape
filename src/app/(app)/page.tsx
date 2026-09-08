import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { STAGE_UI } from "@/core/data/stages";
import { loadSnapshots, pickNextStep } from "@/core/product/next-step";
import { db } from "@/db/client";

import { NextStepCard } from "./next-step-card";
import { RegisterProductForm } from "./register-product-form";

// This list changes every time a product is registered or a diagnosis runs.
// Without this, `next build` prerenders it once as static HTML and `next
// start` would keep serving that snapshot regardless of what is in the
// database — confirmed by hand: a product registered after the build never
// appeared until this was added.
export const dynamic = "force-dynamic";

/**
 * Not a metrics dashboard. The reader has no marketing background and little
 * time, so the page leads with the single next action — decided in code by
 * next-step.ts — and keeps the list of products underneath as context rather
 * than as the main event.
 */
export default async function DashboardPage() {
  const snapshots = await loadSnapshots();
  const step = pickNextStep(snapshots);

  const diagnoses = await Promise.all(
    snapshots.map((snapshot) =>
      db.query.diagnoses.findFirst({
        where: (diagnoses, { eq }) => eq(diagnoses.productId, snapshot.product.id),
        orderBy: (diagnoses, { desc }) => [desc(diagnoses.createdAt)],
      }),
    ),
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6 sm:py-16">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Grape</h1>
        <p className="mt-1 text-sm text-text-muted">
          作ったサービスが使われない理由を調べて、次にやることを一つ出します。
        </p>
      </header>

      <NextStepCard step={step} />

      {snapshots.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-text-muted">登録しているサービス</h2>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {snapshots.map((snapshot, i) => {
              const diagnosis = diagnoses[i];
              return (
                <li key={snapshot.product.id}>
                  <Link
                    href={`/products/${snapshot.product.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-surface-sunken"
                  >
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">{snapshot.product.name}</span>
                      <span className="text-text-muted">{snapshot.product.url}</span>
                    </span>
                    {diagnosis ? (
                      <Badge tone="attention">
                        {STAGE_UI[diagnosis.bottleneckStage].label}で詰まっています
                      </Badge>
                    ) : (
                      <span className="text-xs text-text-muted">まだ調べていません</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section id="register" className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-text-muted">
          {snapshots.length === 0 ? "サービスを登録する" : "別のサービスも見る"}
        </h2>
        <RegisterProductForm />
      </section>
    </div>
  );
}
