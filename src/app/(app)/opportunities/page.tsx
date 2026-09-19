import Link from "next/link";
import { Lightbulb } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function OpportunitiesPage() {
  return (
    <div>
      <PageHeader
        title="機会"
        description="プロダクトと市場の情報から見つかった、認知拡大・利用者獲得・改善につながる可能性のある機会です。"
      />
      <EmptyState
        icon={Lightbulb}
        title="成長機会はまだ見つかっていません"
        description="機会の発見にはプロダクト情報と市場情報が必要です。まずはプロダクトを登録してください。"
        action={
          <Button asChild variant="outline">
            <Link href="/products">プロダクトを登録する</Link>
          </Button>
        }
      />
    </div>
  );
}
