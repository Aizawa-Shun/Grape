import Link from "next/link";
import { Grape } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

/**
 * Overview: ユーザーが最初に開くホーム画面。
 *
 * 目的: 「今何をすべきか」を一目で伝える。
 * 現状(プロダクト未登録): 唯一の次の行動である「プロダクト登録」へ導く。
 * Growth Focus・進行中の実験・承認待ち等の表示は、プロダクトと実データが
 * 揃うPhase 2以降で追加する(ダミーデータでの先行表示は行わない)。
 */
export default function OverviewPage() {
  return (
    <div>
      <PageHeader
        title="概要"
        description="あなたのサービスの状況と、次にやるべきことがここに表示されます。"
      />
      <EmptyState
        icon={Grape}
        title="プロダクトを登録して始めましょう"
        description="Grapeはあなたのサービスと市場を理解し、成長の機会を見つけ、実験を通じて認知拡大・利用者獲得を後押しします。まずはプロダクトを1つ登録してください。"
        action={
          <Button asChild>
            <Link href="/products">プロダクトを登録する</Link>
          </Button>
        }
      />
    </div>
  );
}
