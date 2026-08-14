import type { ScenarioRun } from "@/domain/models";

export function selectLatestCompletedRun<T extends Pick<ScenarioRun, "status" | "completedAt" | "createdAt">>(
  runs: readonly T[],
): T | undefined {
  return runs
    .filter((run) => run.status === "COMPLETED")
    .toSorted((left, right) => {
      const completed = Date.parse(right.completedAt ?? right.createdAt) - Date.parse(left.completedAt ?? left.createdAt);
      return completed !== 0 ? completed : Date.parse(right.createdAt) - Date.parse(left.createdAt);
    })[0];
}
