import type { ScenarioRunStatus } from "@/domain/models";
import { runStatusLabel } from "@/lib/localization";
import { cn } from "@/lib/utils";

export function StatusPill({ status }: { status: ScenarioRunStatus }) {
  const tone =
    status === "COMPLETED"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : status === "FAILED" || status === "CANCELLED"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : "border-blue-200 bg-blue-50 text-blue-800";
  return (
    <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-medium", tone)}>
      {runStatusLabel(status)}
    </span>
  );
}
