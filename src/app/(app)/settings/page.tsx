import { Callout } from "@/components/ui/callout";
import { Page, PageHeader, Section } from "@/components/ui/page";
import {
  currentOverrides,
  loadSettings,
  publicSettings,
  type OverridableKey,
} from "@/core/settings";
import { db } from "@/db/client";
import { env } from "@/env";

import { KeyEventForm } from "../products/[id]/key-event-form";
import { TrackingSnippet } from "../products/[id]/tracking-snippet";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

/**
 * Two kinds of setting, kept visibly apart.
 *
 * Above: this service — the goal action and the snippet, which only mean
 * anything for one product. Below: everything Grape does regardless of which
 * service you are looking at.
 *
 * The values below are stored in the database rather than in .env, because a
 * settings screen that wrote to that file would have shown a save and changed
 * nothing until the next restart. What stays in .env is listed at the bottom
 * and is deliberately not editable here.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const { product: requested } = await searchParams;

  const products = await db.query.products.findMany({
    orderBy: (products, { asc }) => [asc(products.createdAt)],
  });
  const product =
    (requested ? products.find((p) => p.id === requested) : undefined) ?? products[0] ?? null;

  const settings = await loadSettings();
  const overrides = currentOverrides();

  const ingestReachable = !/localhost|127\.0\.0\.1/.test(settings.INGEST_BASE_URL);
  const configuredKeys = [
    { label: "Anthropic APIキー", set: Boolean(env.ANTHROPIC_API_KEY) },
    { label: "OpenAI互換 APIキー", set: Boolean(env.OPENAI_API_KEY) },
    { label: "Xの認証情報", set: Boolean(env.X_CONSUMER_KEY && env.X_ACCESS_TOKEN) },
    { label: "管理パスワード", set: Boolean(env.GRAPE_ADMIN_PASSWORD) },
  ];

  return (
    <Page className="gap-10">
      <PageHeader title="設定" description="変更はすぐ反映されます。再起動は要りません。" />

      {product ? (
        <Section
          title={`${product.name} の設定`}
          description="このサービスにだけ効きます。"
          className="gap-5"
        >
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-text-muted">ゴールの操作</h3>
            <KeyEventForm productId={product.id} keyEventName={product.keyEventName} />
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-medium text-text-muted">計測用のコード</h3>
            <TrackingSnippet productId={product.id} ingestBaseUrl={settings.INGEST_BASE_URL} />
          </div>
        </Section>
      ) : (
        <Callout>
          サービスをまだ登録していないので、サービスごとの設定はありません。
        </Callout>
      )}

      <div className="border-t border-border" />

      {/* publicSettings on both sides: only the overridable keys cross into
          the client bundle, never the secrets that sit beside them in Env. */}
      <SettingsForm
        values={publicSettings(settings)}
        defaults={publicSettings(env)}
        overridden={Object.keys(overrides) as OverridableKey[]}
      />

      <div className="border-t border-border" />

      <Section
        title="ここでは変えられないもの"
        description={
          <>
            鍵と、お金が動く操作のブレーキです。<code className="font-mono">.env</code>{" "}
            を直接編集して、サーバーを再起動してください。
          </>
        }
      >
        <dl className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border text-sm shadow-card">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <dt>
              練習モード
              <span className="block text-xs text-text-muted">
                投稿は取り消せず費用もかかるので、解除は意図的な2手間のままにしています。
              </span>
            </dt>
            <dd className="shrink-0 font-medium">
              {env.GRAPE_ACTION_DRY_RUN ? "オン（送りません）" : "オフ（本当に送ります）"}
            </dd>
          </div>

          {configuredKeys.map((key) => (
            <div key={key.label} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <dt>{key.label}</dt>
              <dd className="shrink-0 text-text-muted">{key.set ? "設定済み" : "未設定"}</dd>
            </div>
          ))}
        </dl>

        {!ingestReachable ? null : (
          <p className="text-xs text-text-muted">
            訪問データの受け取り先は公開アドレスになっています。
          </p>
        )}
      </Section>
    </Page>
  );
}
