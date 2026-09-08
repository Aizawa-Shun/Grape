import Link from "next/link";

import { Card } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { STAGE_UI } from "@/core/data/stages";
import type { FunnelStage } from "@/db/schema";

/**
 * Real content, not a placeholder like its neighbours in the account menu.
 *
 * The audience can build a product but has never done marketing, so the words
 * this app uses — the five stages, the goal action, the practice mode — are
 * the part that needs explaining. Everything here is already true of the
 * running app; nothing describes a feature that does not exist.
 */
const ORDER: FunnelStage[] = ["reach", "visit", "engage", "activate", "retain"];

const LOOP = [
  {
    title: "1. サービスを登録する",
    body: "URLを入れると、サイトを読んで「何を・誰に・何の役に立つか」を書き出します。ここが違っていると、このあとの提案も同じだけずれるので、最初に一度だけ目を通してください。",
  },
  {
    title: "2. 計測用のコードを貼る",
    body: "サイトの全ページに1行貼ると、訪問が届きはじめます。貼らなくても診断はできますが、その場合はサイトの中身だけを見て判断することになります。",
  },
  {
    title: "3. 調べる",
    body: "どこで人が離れているかは計算で出します。AIが書くのは「なぜそうなっているか」の説明だけです。だから、同じ数字なら誰が何回やっても同じ段階が問題として出ます。",
  },
  {
    title: "4. やることを実行する",
    body: "提案には、実際に使う文面まで用意できます。送る前に必ず内容と費用が出て、あなたが押すまで何も出ていきません。",
  },
  {
    title: "5. 効果を測る",
    body: "実施から7日たつと、やる前と後の人数を比べられます。その結果は次に調べるときの材料になるので、同じ提案を繰り返さなくなります。",
  },
];

export default function GuidePage() {
  return (
    <Page className="gap-10">
      <PageHeader title="使い方ガイド" description="Grapeの使い方と、出てくる言葉の意味。" />

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">ひと回りの流れ</h2>
        <ol className="flex flex-col gap-3">
          {LOOP.map((step) => (
            <li key={step.title}>
              <Card className="flex flex-col gap-1">
                <h3 className="text-sm font-medium">{step.title}</h3>
                <p className="text-sm text-text-muted">{step.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-medium">5つの段階</h2>
          <p className="text-xs text-text-muted">
            人がサービスにたどり着いてから、また戻ってくるまでの道のりです。
            どこかで大きく減っていたら、そこが今の問題です。
          </p>
        </div>
        <ol className="flex flex-col divide-y divide-border rounded-md border border-border">
          {ORDER.map((stage, index) => (
            <li key={stage} className="flex gap-3 px-3 py-3">
              <span
                aria-hidden="true"
                className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-surface-sunken text-xs text-text-muted"
              >
                {index + 1}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{STAGE_UI[stage].label}</span>
                <span className="text-sm text-text-muted">{STAGE_UI[stage].help}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">つまずきやすいところ</h2>
        <dl className="flex flex-col gap-4 text-sm">
          <div className="flex flex-col gap-1">
            <dt className="font-medium">「ゴールの操作」って何を決めればいい？</dt>
            <dd className="text-text-muted">
              「ここまで来たら使ってもらえた」と言い切れる操作を1つだけ選びます。登録完了、最初の保存、購入。
              決めるまで、後半の2つの段階は数えようがありません。
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium">まだ誰も来ていないのに使える？</dt>
            <dd className="text-text-muted">
              使えます。人数が少ないうちは割合が当てにならないので、サイトの中身そのものを見て、
              まず何をすべきかを出します。
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium">勝手に投稿されたりしない？</dt>
            <dd className="text-text-muted">
              しません。文面を作る操作と、実行する操作は別で、実行前に内容と費用が出ます。
              さらに既定では「練習モード」で、本当に送るには設定ファイルを書き換える必要があります。
            </dd>
          </div>
        </dl>
      </section>

      <p className="text-sm">
        <Link href="/" className="font-medium underline underline-offset-4">
          ホームにもどる →
        </Link>
      </p>
    </Page>
  );
}
