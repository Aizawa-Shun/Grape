import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState
        icon={SearchX}
        title="ページが見つかりませんでした"
        description="お探しのページは存在しないか、削除された可能性があります。"
        action={
          <Button asChild variant="outline">
            <Link href="/overview">概要へ戻る</Link>
          </Button>
        }
      />
    </div>
  );
}
