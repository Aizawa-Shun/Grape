import { writeFileSync } from "node:fs";

import { render } from "@testing-library/react";
import { describe, it } from "vitest";

import { Page, Section } from "@/components/ui/page";
import type { SaasAssessment } from "@/core/context/analysis";

import { AssessmentChart } from "./assessment-chart";

const OUT = process.env.PREVIEW_OUT;

const assessment: SaasAssessment = {
  clarity: {
    score: 4,
    comment:
      "トップに「オンラインでチェスを遊べる」と一文で書かれており、何をするサービスかは開いて数秒で分かる。",
  },
  audience: {
    score: 2,
    comment:
      "対象読者を名指しする記述が無く、初心者向けか対局者向けかはページから読み取れない。",
  },
  differentiation: {
    score: 2,
    comment: "既存のチェスサイトと何が違うのかに触れた箇所が無く、選ぶ理由が示されていない。",
  },
  credibility: {
    score: 3,
    comment: "利用者数の表示はあるが、運営者情報や事例は見当たらない。",
  },
  action: { score: 4, comment: "「対局する」ボタンがトップの中央にあり、次の一歩は迷わない。" },
  monetization: { score: 1, comment: "料金ページが存在せず、課金の形は一切書かれていない。" },
  summary:
    "何をするサービスかと、次に何をすればよいかは十分に伝わる。一方で、誰のためのもので、他の選択肢ではなくこれを選ぶ理由は書かれていない。訪問者が「自分向けだ」と判断する手がかりが不足している状態である。",
  priority:
    "トップの見出しの下に、想定している利用者を一行で足す。誰向けかが決まれば、差別化の書き方も定まる。",
};

describe.runIf(OUT)("preview", () => {
  it("writes the rendered markup for a visual check", () => {
    const { container } = render(
      <Page>
        <Section
          title="現状の評価"
          description="サイトを読んだAIが、6つの観点で5段階に採点したものです。事実ではなく判断なので、違うと思ったら内容を直してください。"
        >
          <AssessmentChart assessment={assessment} />
        </Section>
      </Page>,
    );

    writeFileSync(OUT as string, container.innerHTML, "utf8");
  });
});
