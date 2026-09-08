import { NotBuiltYet } from "../not-built-yet";

export default function HelpPage() {
  return (
    <NotBuiltYet
      title="ヘルプ・お問い合わせ"
      summary="うまく動かないときの調べ方と、連絡先。"
      planned={[
        "よくある質問",
        "問い合わせフォーム",
        "不具合の報告",
      ]}
      insteadHref="/guide"
      insteadLabel="使い方ガイドを読む"
    />
  );
}
