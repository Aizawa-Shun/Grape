import { headers } from "next/headers";

import { Callout } from "@/components/ui/callout";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { listInvites } from "@/core/auth/users";
import { requireUser } from "@/server/auth/current-user";

import { InviteIssuer } from "./invite-issuer";

export const dynamic = "force-dynamic";

/**
 * The screen for a capability that already worked and had nowhere to be used
 * from: POST /api/auth/invites has existed since registration closed behind
 * the first account, and the README's answer for inviting a second person was
 * to call it by hand. A feature reachable only by curl is, for everyone who
 * does not read the README that far, not a feature.
 *
 * Owner-only, matching the endpoint. A member who arrives here is told why
 * rather than redirected: bouncing someone off a page in the menu they were
 * just shown reads as a fault.
 */
export default async function InvitesPage() {
  const user = await requireUser();

  if (user.role !== "owner") {
    return (
      <Page>
        <PageHeader title="招待" />
        <Callout tone="attention">
          招待を発行できるのはオーナーだけです。このGrapeを立てた人に頼んでください。
        </Callout>
      </Page>
    );
  }

  const invites = await listInvites();

  // The address the owner is looking at right now, rather than a configured
  // one: whatever host reached this page is by definition a host that reaches
  // this Grape, which is the only property the link needs. INGEST_BASE_URL is
  // usually the same value, but it is allowed to be a custom domain pointed at
  // the ingest endpoint alone.
  const head = await headers();
  const host = head.get("host") ?? "localhost:3000";
  const proto = head.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  return (
    <Page>
      <PageHeader
        title="招待"
        description="このGrapeに人を増やします。登録は最初のアカウントで閉じているので、2人目からは招待リンクが要ります。"
      />

      <Section>
        <InviteIssuer
          origin={origin}
          initial={invites.map((invite) => ({
            ...invite,
            createdAt: invite.createdAt.toISOString(),
            expiresAt: invite.expiresAt.toISOString(),
            usedAt: invite.usedAt?.toISOString() ?? null,
          }))}
        />
      </Section>
    </Page>
  );
}
