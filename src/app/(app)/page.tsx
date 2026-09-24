import { Page, Section } from "@/components/ui/page";
import { TextLink } from "@/components/ui/text-link";
import { buildBriefing } from "@/core/product/briefing";
import { loadSnapshots } from "@/core/product/next-step";
import { requireUser } from "@/server/auth/current-user";

import { BriefingView } from "./briefing-view";
import { ProductList, listItemsFrom } from "./product-list";
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
  const user = await requireUser();
  const snapshots = await loadSnapshots(user.id);
  const briefing = buildBriefing(snapshots);

  return (
    <Page>
      <BriefingView briefing={briefing} />

      {snapshots.length > 0 && (
        <Section
          title="登録しているサービス"
          actions={<TextLink href="/products" className="text-xs">一覧を開く</TextLink>}
        >
          <ProductList products={listItemsFrom(snapshots)} />
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
