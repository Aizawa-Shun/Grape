import type { AgentAction } from "@/db/schema";

/** The Activity Log (spec §24): what the agent did, in its own sentences, newest first. */
export function ActivityLog({ actions }: { actions: AgentAction[] }) {
  if (actions.length === 0) return <p className="text-sm text-text-muted">まだ記録はありません。</p>;
  return (
    <ol className="flex flex-col divide-y divide-border rounded-md border border-border text-sm shadow-card">
      {actions.map((action) => (
        <li key={action.id} className="flex gap-3 px-3 py-2">
          <time dateTime={action.createdAt.toISOString()} className="w-20 shrink-0 text-xs tabular-nums text-text-subtle">
            {action.createdAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </time>
          <span className="text-text-muted">{action.summary}</span>
        </li>
      ))}
    </ol>
  );
}
