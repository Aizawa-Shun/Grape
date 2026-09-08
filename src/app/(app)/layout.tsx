import type { ReactNode } from "react";

import { AppShell } from "@/components/nav/app-shell";
import { loadNavProducts } from "@/core/product/nav";
import { env } from "@/env";

/**
 * Everything behind the sidebar. /login sits outside this group on purpose —
 * showing navigation to someone who cannot use any of it is just noise.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const products = await loadNavProducts();

  return (
    <AppShell products={products} authEnabled={Boolean(env.GRAPE_ADMIN_PASSWORD)}>
      {children}
    </AppShell>
  );
}
