import Link from "next/link";

import { Card } from "@/components/ui/card";
import type { NextStep } from "@/core/product/next-step";

/**
 * The one thing to do, in one card.
 *
 * Not a list of metrics: the reader has no time and no marketing background,
 * and a wall of numbers asks them to work out what matters before they can
 * act. Every state here answers "what do I do now" in a sentence, and links
 * straight to the place it gets done.
 */

interface Copy {
  eyebrow: string;
  headline: string;
  detail: string;
  action: string;
  href: string;
}

function copyFor(step: NextStep): Copy {
  switch (step.kind) {
    case "register":
      return {
        eyebrow: "はじめに",
        headline: "調べたいサービスを1つ登録してください",
        detail: "URLを入れると、サイトを読んで、何のサービスかを整理します。",
        action: "下のフォームから追加",
        href: "#register",
      };
    case "review_task":
      return {
        eyebrow: "確認まち",
        headline: `「${step.task.title}」の文面ができています`,
        detail: "中身を読んで、よければ実行してください。送る前に内容と費用を確認できます。",
        action: `${step.product.name} を開く`,
        href: `/products/${step.product.id}`,
      };
    case "measure_outcome":
      return {
        eyebrow: "効果を確かめる",
        headline: `「${step.task.title}」から7日たちました`,
        detail: "やる前とやった後で数字が動いたかを測れます。結果は次の診断にも使われます。",
        action: `${step.product.name} を開く`,
        href: `/products/${step.product.id}`,
      };
    case "generate_artifact":
      return {
        eyebrow: "次の一手",
        headline: `「${step.task.title}」に取りかかれます`,
        detail: "実際に使う文面を用意します。まだ何も送られません。",
        action: `${step.product.name} を開く`,
        href: `/products/${step.product.id}`,
      };
    case "verify_context":
      return {
        eyebrow: "先に確認",
        headline: "サービスの説明が合っているか見てください",
        detail:
          "サイトから自動で書いたものです。ここが違うと、このあとの診断も提案も同じだけずれます。",
        action: `${step.product.name} を開く`,
        href: `/products/${step.product.id}`,
      };
    case "run_diagnosis":
      return {
        eyebrow: "次の一手",
        headline:
          step.reason === "never"
            ? "どこが詰まっているかを調べましょう"
            : "前回の診断から1週間たちました",
        detail:
          step.reason === "never"
            ? "まだ人が来ていなくても大丈夫です。その場合はサイト自体を見て、何から始めるべきかを出します。"
            : "そのあとの変化をふまえて、いまの一番の問題を出し直します。",
        action: `${step.product.name} を開く`,
        href: `/products/${step.product.id}`,
      };
    case "install_snippet":
      return {
        eyebrow: "そろそろ",
        headline: "サイトに計測用のコードを貼ってください",
        detail:
          "まだ訪問が1件も届いていません。貼ると、どこで人が離れているかが分かるようになります。",
        action: `${step.product.name} を開く`,
        href: `/products/${step.product.id}`,
      };
    case "set_key_event":
      return {
        eyebrow: "そろそろ",
        headline: "「ここまで来たら成功」を決めてください",
        detail: "登録完了など、ゴールになる操作を1つ決めると、そこまで届いた人を数えられます。",
        action: `${step.product.name} を開く`,
        href: `/products/${step.product.id}`,
      };
    case "waiting":
      return {
        eyebrow: "待ち",
        headline: "いまやることはありません",
        detail: `「${step.task.title}」の効果は ${step.readyAt.toLocaleDateString("ja-JP")} に測れます。それまでは様子を見ましょう。`,
        action: `${step.product.name} を開く`,
        href: `/products/${step.product.id}`,
      };
    case "idle":
      return {
        eyebrow: "ひと段落",
        headline: "今週の分は終わっています",
        detail: "新しい提案がほしくなったら、もう一度診断を実行してください。",
        action: `${step.product.name} を開く`,
        href: `/products/${step.product.id}`,
      };
  }
}

export function NextStepCard({ step }: { step: NextStep }) {
  const copy = copyFor(step);
  const quiet = step.kind === "waiting" || step.kind === "idle";

  return (
    <Card emphasis={quiet ? "default" : "attention"} className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{copy.eyebrow}</p>
      <h2 className="text-lg font-semibold leading-snug">{copy.headline}</h2>
      <p className="text-sm text-text-muted">{copy.detail}</p>
      <Link
        href={copy.href}
        className="mt-1 self-start text-sm font-medium underline underline-offset-4"
      >
        {copy.action} →
      </Link>
    </Card>
  );
}
