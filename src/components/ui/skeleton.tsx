import { cn } from "@/lib/utils";

/** ローディング中のプレースホルダー。実データが確定するまで数値・文言を表示しない。 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
