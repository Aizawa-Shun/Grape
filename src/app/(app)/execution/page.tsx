import Link from "next/link";
import { PlayCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function ExecutionPage() {
  return (
    <div>
      <PageHeader
        title="実行"
        description="承認済みの施策の実行待ち・実行中・実行履歴と、外部連携の状態を確認します。"
      />
      <EmptyState
        icon={PlayCircle}
        title="実行待ちの施策はまだありません"
        description="承認された実験がここに表示されます。まずはプロダクトを登録し、実験を作成しましょう。"
        action={
          <Button asChild variant="outline">
            <Link href="/products">プロダクトを登録する</Link>
          </Button>
        }
      />
    </div>
  );
}
