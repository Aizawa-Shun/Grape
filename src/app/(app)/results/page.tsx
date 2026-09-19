import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function ResultsPage() {
  return (
    <div>
      <PageHeader
        title="結果"
        description="実験の結果(流入・登録・利用などの指標)と、そこから得られた学びを記録します。"
      />
      <EmptyState
        icon={BarChart3}
        title="結果はまだありません"
        description="実験を実行すると、その結果と学びがここに蓄積されます。まずはプロダクトを登録しましょう。"
        action={
          <Button asChild variant="outline">
            <Link href="/products">プロダクトを登録する</Link>
          </Button>
        }
      />
    </div>
  );
}
