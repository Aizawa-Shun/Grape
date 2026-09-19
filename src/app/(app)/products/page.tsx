import { Package } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Products: プロダクト(自分のWebアプリ)の登録・一覧・編集を行う画面。
 *
 * Phase 1時点では登録フォーム・保存処理は未実装(Phase 2で実装)。
 * ここに偽の登録ボタンは置かない — 押しても何も起きないUIを作らないため。
 */
export default function ProductsPage() {
  return (
    <div>
      <PageHeader
        title="プロダクト"
        description="URL・サービス概要・想定顧客・解決する課題を登録すると、Grapeがあなたのサービスを理解し始めます。"
      />
      <EmptyState
        icon={Package}
        title="登録されたプロダクトはまだありません"
        description="プロダクト登録機能は次のフェーズ(Phase 2: Product Onboarding)で有効になります。"
      />
    </div>
  );
}
