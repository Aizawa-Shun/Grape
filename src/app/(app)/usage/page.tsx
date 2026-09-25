import Link from "next/link";

import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/empty-state";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { TextLink } from "@/components/ui/text-link";
import { monthUsage, type SpendGroup } from "@/core/llm/budget";
import { requireUser } from "@/server/auth/current-user";

export const dynamic = "force-dynamic";

/**
 * Not a billing page. Grape is self-hosted and bills nobody — the account menu
 * used to link to a プランと請求 screen promising a plan and an invoice, and a
 * test still keeps that gone, because there is no such thing to show.
 *
 * What there is instead is a real number with a real cause: the AI calls the
 * viewer's own account made, estimated against list prices, against the
 * ceiling in settings. Scoped per account because each one now calls the
 * model on its own API key (see /account) — there is no single instance-wide
 * bill left to show. /settings shows the same total beside the limit it is
 * checked against; this answers the question you have after reading it —
 * where did it go.
 */

const TASK_LABELS: Record<string, string> = {
  extract: "サイトの読み取り",
  diagnose: "診断",
  generate: "文面の作成",
  research: "市場調査・見込み客探し",
};

function usd(value: number): string {
  // Four places below a cent: a single small-model call rounds to $0.00 at two,
  // and a list of zeroes summing to a visible total reads as a bug. Exactly
  // zero is not that case — it is the honest number, and $0.0000 only looks
  // like an instrument that cannot round.
  if (value === 0) return "$0.00";
  return value >= 0.01 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

function Bar({ ratio, over }: { ratio: number; over: boolean }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
      <div
        className={cx("h-full rounded-full", over ? "bg-negative" : "bg-accent")}
        style={{ width: `${Math.min(100, Math.max(ratio * 100, ratio > 0 ? 2 : 0))}%` }}
      />
    </div>
  );
}

function Breakdown({ rows, label }: { rows: SpendGroup[]; label: (key: string) => string }) {
  const largest = Math.max(...rows.map((row) => row.costUsd), 0);

  return (
    <Card>
      <dl className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="truncate text-sm">{label(row.key)}</dt>
              <dd className="shrink-0 text-sm tabular-nums">
                {usd(row.costUsd)}
                <span className="ml-2 text-xs text-text-muted">{row.calls}回</span>
              </dd>
            </div>
            <Bar ratio={largest > 0 ? row.costUsd / largest : 0} over={false} />
          </div>
        ))}
      </dl>
    </Card>
  );
}

export default async function UsagePage() {
  const user = await requireUser();
  // Your own usage, not the whole instance's: each account now calls the
  // model on its own API key (see /account), and that is also the boundary
  // the monthly cap is checked against (core/llm/budget.ts).
  const usage = await monthUsage(undefined, undefined, user.id);

  const ratio = usage.budgetUsd > 0 ? usage.spentUsd / usage.budgetUsd : 0;
  const exhausted = usage.spentUsd >= usage.budgetUsd;

  return (
    <Page>
      <PageHeader
        title="AI利用料"
        description="今月あなたが使ったAIの見積り額です。実際の請求額とは差が出ます。"
      />

      <Section title="今月">
        <Card emphasis={exhausted ? "attention" : "default"}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-2xl font-semibold tabular-nums">{usd(usage.spentUsd)}</span>
            <span className="text-sm text-text-muted tabular-nums">
              上限 ${usage.budgetUsd.toFixed(2)}
            </span>
          </div>
          <div className="mt-3">
            <Bar ratio={ratio} over={exhausted} />
          </div>
          <p className="mt-2 text-xs text-text-muted">
            {exhausted
              ? "上限に達しているので、来月まで新しいAI呼び出しは止まっています。"
              : `上限まで残り ${usd(Math.max(0, usage.budgetUsd - usage.spentUsd))} です。`}{" "}
            <TextLink href="/settings">上限を変える</TextLink>
          </p>
        </Card>
      </Section>

      {usage.recent.length === 0 ? (
        <EmptyState
          title="今月はまだAIを使っていません"
          body={
            <>
              サービスを登録するか、診断を実行すると、ここに内訳が出ます。
              <Link href="/" className="ml-1 underline">
                ホームへ
              </Link>
            </>
          }
        />
      ) : (
        <>
          <Section title="何に使ったか">
            <Breakdown rows={usage.byTaskKind} label={(key) => TASK_LABELS[key] ?? key} />
          </Section>

          <Section title="どのモデルか">
            <Breakdown rows={usage.byModel} label={(key) => key} />
          </Section>

          <Section
            title="直近の呼び出し"
            description="ひとりでに増えていないか、ここで分かります。"
          >
            <Card>
              <ul className="flex flex-col gap-2">
                {usage.recent.map((call) => (
                  <li key={call.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">
                      {TASK_LABELS[call.taskKind] ?? call.taskKind}
                      <span className="ml-2 text-xs text-text-muted">{call.model}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-text-muted">
                      {usd(call.costUsd)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </Section>
        </>
      )}

      <Callout>
        金額は core/llm/pricing.ts の定価表による見積りで、実際の請求とは差が出ます。
      </Callout>
    </Page>
  );
}
