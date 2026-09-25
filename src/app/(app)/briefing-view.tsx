import Link from "next/link";

import { Card } from "@/components/ui/card";
import { STAGE_UI } from "@/core/data/stages";
import type { Briefing } from "@/core/product/briefing";
import type { NextStep } from "@/core/product/next-step";

/**
 * Where things stand, then anything worth celebrating, then one thing to do.
 *
 * In that order on purpose. The headline orients someone who has been away a
 * week; the celebration is the evidence that the last round of effort was
 * worth it; the suggestion is what they came to find. A list of metrics would
 * put the work of deciding back on the reader, which is the one thing this
 * page exists to take off them.
 */

interface StepCopy {
  eyebrow: string;
  headline: string;
  detail: string;
  action: string;
  href: string;
}

function copyForStep(step: NextStep): StepCopy {
  switch (step.kind) {
    case "register":
      return {
        eyebrow: "はじめに",
        headline: "作ったSaaSのURLを入れてください。ユーザー探しはAIがやります。",
        detail:
          "サイトを読んで何のサービスかを理解し、市場・競合・見込み客を調べて、最初のグロース計画と投稿案を作ります。あなたは確認して承認するだけです。",
        action: "下のフォームから始める",
        href: "#register",
      };
    case "review_task":
      return {
        eyebrow: "確認まち",
        headline: `「${step.task.title}」の文面ができています`,
        detail: "中身を読んで、よければ実行してください。送る前に内容と費用を確認できます。",
        action: "確認する",
        href: `/products/${step.product.id}/tasks`,
      };
    case "measure_outcome":
      return {
        eyebrow: "効果を確かめる",
        headline: `「${step.task.title}」から7日たちました`,
        detail: "やる前とやった後で数字が動いたかを測れます。結果は次に調べるときにも使われます。",
        action: "測ってみる",
        href: `/products/${step.product.id}/tasks`,
      };
    case "generate_artifact":
      return {
        eyebrow: "次の一手",
        headline: `「${step.task.title}」に取りかかれます`,
        detail: "実際に使う文面を用意します。まだ何も送られません。",
        action: "やることを見る",
        href: `/products/${step.product.id}/tasks`,
      };
    case "verify_context":
      return {
        eyebrow: "先に確認",
        headline: "サービスの説明が合っているか見てください",
        detail:
          "サイトから自動で書いたものです。ここが違うと、このあとの診断も提案も同じだけずれます。",
        action: "内容を見る",
        href: `/products/${step.product.id}/review`,
      };
    case "run_diagnosis":
      return {
        eyebrow: "次の一手",
        headline:
          step.reason === "never"
            ? "どこが詰まっているかを調べましょう"
            : "前回調べてから1週間たちました",
        detail:
          step.reason === "never"
            ? "まだ人が来ていなくても大丈夫です。その場合はサイト自体を見て、何から始めるべきかを出します。"
            : "そのあとの変化をふまえて、いまの一番の問題を出し直します。",
        action: "調べる",
        href: `/products/${step.product.id}/tasks`,
      };
    case "install_snippet":
      return {
        eyebrow: "そろそろ",
        headline: "サイトに計測用のコードを貼ってください",
        detail:
          "まだ訪問が1件も届いていません。貼ると、どこで人が離れているかが分かるようになります。",
        action: "コードを見る",
        href: "/settings",
      };
    case "set_key_event":
      return {
        eyebrow: "そろそろ",
        headline: "「ここまで来たら成功」を決めてください",
        detail: "登録完了など、ゴールになる操作を1つ決めると、そこまで届いた人を数えられます。",
        action: "決める",
        href: "/settings",
      };
    case "waiting":
      return {
        eyebrow: "待ち",
        headline: "いま急いでやることはありません",
        detail: `「${step.task.title}」の効果は ${step.readyAt.toLocaleDateString("ja-JP")} に測れます。それまでは様子を見ましょう。`,
        action: "いまの流れを見る",
        href: `/products/${step.product.id}/funnel`,
      };
    case "idle":
      return {
        eyebrow: "ひと段落",
        headline: "今回の分は終わっています",
        detail: "新しい提案がほしくなったら、もう一度調べてください。",
        action: "調べ直す",
        href: `/products/${step.product.id}/tasks`,
      };
  }
}

export function BriefingView({ briefing }: { briefing: Briefing }) {
  const step = copyForStep(briefing.step);
  const quiet = briefing.step.kind === "waiting" || briefing.step.kind === "idle";

  return (
    <div className="flex flex-col gap-4">
      {/*
        The page heading, not a lead paragraph. The home page used to open
        with <h1>Grape</h1> — the app's own name, already in the sidebar —
        which spent the most valuable line on the screen saying nothing. The
        situation is what this page is actually about, so it is the h1.
      */}
      <h1 className="text-xl font-semibold leading-snug tracking-tight">{briefing.headline}</h1>

      {briefing.celebration && <CelebrationNote celebration={briefing.celebration} />}

      <Card emphasis={quiet ? "default" : "attention"} className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
          {step.eyebrow}
        </p>
        <h2 className="text-base font-semibold leading-snug">{step.headline}</h2>
        <p className="text-sm text-text-muted">{step.detail}</p>
        <Link
          href={step.href}
          className="mt-1 self-start text-sm font-medium underline underline-offset-4"
        >
          {step.action} →
        </Link>
      </Card>
    </div>
  );
}

function CelebrationNote({ celebration }: { celebration: NonNullable<Briefing["celebration"]> }) {
  const stage = STAGE_UI[celebration.stage];

  return (
    <div className="flex flex-col gap-1 rounded-md border border-positive/30 bg-positive/5 px-3 py-2.5">
      <p className="text-sm font-medium text-positive">効きました</p>
      <p className="text-sm">
        「{celebration.taskTitle}」のあと、{stage.label}が {celebration.before} 人から{" "}
        <span className="font-semibold">{celebration.after} 人</span> に増えました（
        {celebration.windowDays}日後）。
      </p>
    </div>
  );
}
