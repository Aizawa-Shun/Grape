import type { MeasurementFunnel } from "@/db/schema";
import { funnelRows } from "@/core/growth/measurement";

import { pct } from "./brain-parts";

/**
 * Impressions → engagement → profile → site → signup → activation → paid
 * (spec §8), with "not measured" shown as such — never as a zero.
 */
export function FunnelCard({ funnel }: { funnel: MeasurementFunnel }) {
  const rows = funnelRows(funnel);
  return (
    <ol className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[8.5rem_4rem_1fr] items-baseline gap-2 text-sm">
          <span className="text-text-muted">{row.label}</span>
          <span className="text-right font-semibold tabular-nums">{row.value === null ? "—" : row.value.toLocaleString("ja-JP")}</span>
          <span className="truncate text-xs text-text-subtle">
            {row.value === null ? row.missing : row.rate ? `${row.rate.label} ${pct(row.rate.value)}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}
