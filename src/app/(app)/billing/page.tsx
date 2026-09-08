import { NotBuiltYet } from "../not-built-yet";

export default function BillingPage() {
  return (
    <NotBuiltYet
      title="プランと請求"
      summary="利用量の確認、プランの変更、支払い方法。"
      planned={[
        "今月の利用量（診断の回数、AIの使用量）",
        "プランの変更",
        "支払い方法と請求書",
      ]}
      insteadHref="/settings"
      insteadLabel="AIの接続先を確認する"
    />
  );
}
