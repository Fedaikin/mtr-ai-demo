import type { ScenarioRun } from "@/domain/models";

export function selectLatestCompletedRun<T extends Pick<ScenarioRun, "id" | "status" | "completedAt" | "createdAt">>(
  runs: readonly T[],
): T | undefined {
  return runs
    .filter((run) => run.status === "COMPLETED")
    .toSorted((left, right) => {
      const completed = Date.parse(right.completedAt ?? right.createdAt) - Date.parse(left.completedAt ?? left.createdAt);
      if (completed !== 0) return completed;
      const created = Date.parse(right.createdAt) - Date.parse(left.createdAt);
      return created !== 0 ? created : right.id.localeCompare(left.id, "en");
    })[0];
}
