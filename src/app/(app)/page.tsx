import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Page, Section } from "@/components/ui/page";
import { STAGE_UI } from "@/core/data/stages";
import { buildBriefing } from "@/core/product/briefing";
import { loadSnapshots } from "@/core/product/next-step";
import { db } from "@/db/client";

import { BriefingView } from "./briefing-view";
import { RegisterProductForm } from "./register-product-form";

// This list changes every time a product is registered or a diagnosis runs.
// Without this, `next build` prerenders it once as static HTML and `next
// start` would keep serving that snapshot regardless of what is in the
// database — confirmed by hand: a product registered after the build never
// appeared until this was added.
export const dynamic = "force-dynamic";

/**
 * A briefing, not a dashboard. The reader has no marketing background and
 * little time, so the page opens with where things stand, says so when the
 * last round of work actually paid off, and offers exactly one next action —
 * all decided in code by briefing.ts and next-step.ts. The list of services
 * stays underneath as context rather than as the main event.
 */
export default async function DashboardPage() {
  const snapshots = await loadSnapshots();
  const briefing = buildBriefing(snapshots);

  const diagnoses = await Promise.all(
    snapshots.map((snapshot) =>
      db.query.diagnoses.findFirst({
        where: (diagnoses, { eq }) => eq(diagnoses.productId, snapshot.product.id),
        orderBy: (diagnoses, { desc }) => [desc(diagnoses.createdAt)],
      }),
    ),
  );

  return (
    <Page>
      <BriefingView briefing={briefing} />

      {snapshots.length > 0 && (
        <Section title="登録しているサービス">
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border shadow-card">
            {snapshots.map((snapshot, i) => {
              const diagnosis = diagnoses[i];
              return (
                <li key={snapshot.product.id}>
                  <Link
                    href={`/products/${snapshot.product.id}`}
                    className="group flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm transition-colors hover:bg-surface-sunken"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">{snapshot.product.name}</span>
                      <span className="truncate text-text-muted">{snapshot.product.url}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {diagnosis ? (
                        <Badge tone="attention">
                          {STAGE_UI[diagnosis.bottleneckStage].label}で詰まっています
                        </Badge>
                      ) : (
                        <span className="text-xs text-text-muted">まだ調べていません</span>
                      )}
                      {/*
                        Appears only on hover, so a row that is a link looks
                        like one without the list becoming a column of arrows.
                      */}
                      <span
                        aria-hidden="true"
                        className="text-text-subtle opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        →
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section
        id="register"
        title={snapshots.length === 0 ? "サービスを登録する" : "別のサービスも見る"}
      >
        <RegisterProductForm />
      </Section>
    </Page>
  );
}
