import Link from "next/link";
import { Compass } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function MarketPage() {
  return (
    <div>
      <PageHeader
        title="市場"
        description="ターゲット顧客・顧客課題・競合や代替手段・顧客が情報を探す場所についての調査結果を整理します。"
      />
      <EmptyState
        icon={Compass}
        title="市場インテリジェンスはまだありません"
        description="市場調査はプロダクト登録後に開始できます。まずはプロダクトを登録してください。"
        action={
          <Button asChild variant="outline">
            <Link href="/products">プロダクトを登録する</Link>
          </Button>
        }
      />
    </div>
  );
}
