import { notFound } from "next/navigation";

import { Callout } from "@/components/ui/callout";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { TextLink } from "@/components/ui/text-link";
import { DEFAULT_GOAL } from "@/core/growth/goals";
import { getKnowledge } from "@/core/growth/knowledge";
import { getPolicy } from "@/core/growth/policy";
import { activeGoal } from "@/core/growth/latest";
import { findOwnedProduct } from "@/core/product/ownership";
import { loadSettings } from "@/core/settings";
import { requireUser } from "@/server/auth/current-user";

import { BrandVoiceForm, GoalForm, PolicyForm } from "./forms";

export const dynamic = "force-dynamic";

/** The goal, how much the agent may do on its own, and how it should sound. */
export default async function GrowthSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await findOwnedProduct(id, (await requireUser()).id);
  if (!product) notFound();

  const [policy, goal, knowledge, settings] = await Promise.all([getPolicy(id), activeGoal(id), getKnowledge(id), loadSettings()]);
  const days = goal ? Math.max(1, Math.round((goal.deadline.getTime() - goal.startAt.getTime()) / 86_400_000)) : DEFAULT_GOAL.days;

  return (
    <Page>
      <PageHeader title="自動化と安全" description="目標、AIに任せる範囲、出すものの上限と文体を決めます。" />

      {settings.GRAPE_ACTION_DRY_RUN && (
        <Callout>
          練習モードがオンです。どのモードでも、Xへは実際には送信されません（<TextLink href="/settings">設定</TextLink>で切り替え）。
        </Callout>
      )}

      <Section id="goal" title="目標">
        <GoalForm productId={id} initial={{ metric: goal?.metric ?? DEFAULT_GOAL.metric, target: goal?.target ?? DEFAULT_GOAL.target, days }} />
      </Section>

      <Section title="承認モードと安全のルール" description="上限と禁止ワードは、あなたが承認するときにも適用されます。時間帯と関連度の下限は、AIが自分で実行するときだけ適用されます。">
        <PolicyForm productId={id} policy={policy} />
      </Section>

      <Section title="文体（Brand Voice）" description="あなたの文章を学んで、投稿と返信をあなたらしく書きます。">
        {knowledge ? <BrandVoiceForm productId={id} voice={knowledge.brandVoice} /> : <p className="text-sm text-text-muted">最初の分析が終わると設定できます。</p>}
      </Section>
    </Page>
  );
}
