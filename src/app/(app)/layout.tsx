import type { ReactNode } from "react";

import { AppShell } from "@/components/nav/app-shell";
import { loadNavProducts } from "@/core/product/nav";
import { requireUser } from "@/server/auth/current-user";

/**
 * Everything behind the sidebar. /login sits outside this group on purpose —
 * showing navigation to someone who cannot use any of it is just noise.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const products = await loadNavProducts(user.id);

  return (
    <AppShell products={products} account={{ displayName: user.displayName, email: user.email }}>
      {children}
    </AppShell>
  );
}
