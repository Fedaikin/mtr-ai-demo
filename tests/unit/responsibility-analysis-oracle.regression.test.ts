import { describe, expect, it } from "vitest";

import { summarizeResponsibilityDecisions } from "@/domain/responsibility";
import { selectLatestCompletedRun } from "@/lib/latest-completed-run";

describe("responsibility analysis acceptance oracle", () => {
  it("выбирает новый immutable COMPLETED run по completedAt, независимо от порядка repository", () => {
    const oldRun = {
      id: "run-old",
      status: "COMPLETED" as const,
      createdAt: "2026-08-13T09:00:00.000Z",
      completedAt: "2026-08-13T09:05:00.000Z",
    };
    const newRun = {
      id: "run-new",
      status: "COMPLETED" as const,
      createdAt: "2026-08-13T10:00:00.000Z",
      completedAt: "2026-08-13T10:05:00.000Z",
    };

    expect(selectLatestCompletedRun([
      newRun,
      { id: "run-failed", status: "FAILED" as const, createdAt: "2026-08-13T11:00:00.000Z" },
      oldRun,
    ])).toBe(newRun);
  });

  it("детерминированно выбирает run по ID при одинаковых completedAt и createdAt", () => {
    const left = { id: "run-001", status: "COMPLETED" as const, createdAt: "2026-08-13T10:00:00.000Z", completedAt: "2026-08-13T10:05:00.000Z" };
    const right = { ...left, id: "run-002" };
    expect(selectLatestCompletedRun([left, right])).toBe(right);
    expect(selectLatestCompletedRun([right, left])).toBe(right);
  });

  it("пересчитывает агрегаты из строк и исключает review/insufficient из CUSTOMER/CONTRACTOR", () => {
    const rows = [
      row("RESOLVED", "CUSTOMER"),
      row("RESOLVED", "CONTRACTOR"),
      row("REVIEW_REQUIRED", "CUSTOMER", true),
      row("REVIEW_REQUIRED", null, true),
      row("INSUFFICIENT_DATA", null, true),
      { ...row(undefined, "CONTRACTOR", true), responsibilityCitation: { clauseId: "UNRESOLVED" } },
    ];

    expect(summarizeResponsibilityDecisions(rows)).toEqual({
      total: 6,
      customer: 1,
      contractor: 1,
      reviewRequired: 2,
      insufficientData: 2,
    });
  });
});

function row(
  responsibilityDecisionState: "RESOLVED" | "REVIEW_REQUIRED" | "INSUFFICIENT_DATA" | undefined,
  responsibility: "CUSTOMER" | "CONTRACTOR" | null,
  requiresHumanReview = false,
) {
  return {
    ...(responsibilityDecisionState ? { responsibilityDecisionState } : {}),
    responsibility,
    responsibilityCitation: responsibility === null ? null : { clauseId: "4.2" },
    requiresHumanReview,
  };
}
