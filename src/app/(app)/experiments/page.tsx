import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

export default function ExperimentsPage() {
  return (
    <div>
      <PageHeader
        title="実験"
        description="目的・仮説・対象・チャネル・成功指標を持つ、具体的な施策として成長機会を検証します。"
      />
      <EmptyState
        icon={FlaskConical}
        title="実験はまだありません"
        description="実験は「機会」から作成します。まずはプロダクトを登録し、成長機会を見つけましょう。"
        action={
          <Button asChild variant="outline">
            <Link href="/products">プロダクトを登録する</Link>
          </Button>
        }
      />
    </div>
  );
}
