import Link from "next/link";

import { db } from "@/db/client";

import { RegisterProductForm } from "./register-product-form";

// This list changes every time a product is registered or a diagnosis runs.
// Without this, `next build` prerenders it once as static HTML and `next
// start` would keep serving that snapshot regardless of what is in the
// database — confirmed by hand: a product registered after the build never
// appeared until this was added.
export const dynamic = "force-dynamic";

const STAGE_LABELS: Record<string, string> = {
  reach: "Reach",
  visit: "Visit",
  engage: "Engage",
  activate: "Activate",
  retain: "Retain",
};

/**
 * The Growth Dashboard — what someone sees first, per spec §4. Not a chat
 * window: a list of registered products, each with its current bottleneck
 * (now that M3's diagnose.ts exists) so the answer to "what should I look at
 * today" is visible without opening every product.
 */
export default async function DashboardPage() {
  const products = await db.query.products.findMany({
    orderBy: (products, { desc }) => [desc(products.createdAt)],
  });

  const latestDiagnoses = await Promise.all(
    products.map((product) =>
      db.query.diagnoses.findFirst({
        where: (diagnoses, { eq }) => eq(diagnoses.productId, product.id),
        orderBy: (diagnoses, { desc }) => [desc(diagnoses.createdAt)],
      }),
    ),
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Grape</h1>
        <p className="mt-1 text-sm text-zinc-500">Indie Product Growth OS</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-zinc-500">プロダクトを登録</h2>
        <RegisterProductForm />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-zinc-500">登録済みプロダクト</h2>
        {products.length === 0 ? (
          <p className="text-sm text-zinc-400">まだプロダクトが登録されていません。</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {products.map((product, i) => {
              const diagnosis = latestDiagnoses[i];
              return (
                <li key={product.id}>
                  <Link
                    href={`/products/${product.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{product.name}</span>
                      <span className="text-zinc-400">{product.url}</span>
                    </div>
                    {diagnosis ? (
                      <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-400">
                        {STAGE_LABELS[diagnosis.bottleneckStage] ?? diagnosis.bottleneckStage}
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-zinc-400">未診断</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
