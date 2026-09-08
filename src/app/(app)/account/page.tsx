import { NotBuiltYet } from "../not-built-yet";

export default function AccountPage() {
  return (
    <NotBuiltYet
      title="アカウント設定"
      summary="名前やメールアドレス、パスワードの変更。"
      planned={[
        "表示名とメールアドレス",
        "パスワードの変更",
        "ログイン中の端末の確認",
      ]}
      insteadHref="/settings"
      insteadLabel="いま変えられる設定を見る"
    />
  );
}
