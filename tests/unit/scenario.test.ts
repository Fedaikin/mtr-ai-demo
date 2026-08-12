import type { ScenarioRunStatus } from "@/domain/models";
import {
  canCancel,
  nextRunStatus,
  RUN_PROGRESS,
  RUN_STATUS_LABELS,
  TERMINAL_STATUSES,
} from "@/domain/scenario";

describe("scenario state machine", () => {
  const successfulPath: ScenarioRunStatus[] = [
    "QUEUED",
    "LOADING_APPIUS",
    "SYNCING_SAP",
    "CLASSIFYING_RESPONSIBILITY",
    "MATCHING_STOCK",
    "FINDING_ANALOGUES",
    "GENERATING_REPORT",
    "COMPLETED",
  ];

  it("follows the complete deterministic transition path", () => {
    for (let index = 0; index < successfulPath.length - 1; index += 1) {
      expect(nextRunStatus(successfulPath[index])).toBe(successfulPath[index + 1]);
    }
    expect(nextRunStatus("COMPLETED")).toBeNull();
  });

  it("is idempotent for repeated transition reads", () => {
    for (const status of successfulPath) {
      expect(nextRunStatus(status)).toBe(nextRunStatus(status));
    }
  });

  it("never decreases progress on the successful path", () => {
    const progress = successfulPath.map((status) => RUN_PROGRESS[status]);

    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(100);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
  });

  it.each(["COMPLETED", "FAILED", "CANCELLED"] as const)(
    "keeps terminal status %s closed and non-cancellable",
    (status) => {
      expect(TERMINAL_STATUSES.has(status)).toBe(true);
      expect(nextRunStatus(status)).toBeNull();
      expect(canCancel(status)).toBe(false);
      expect(RUN_PROGRESS[status]).toBe(100);
    },
  );

  it("allows cancellation only while work is active", () => {
    for (const status of successfulPath.slice(0, -1)) {
      expect(canCancel(status)).toBe(true);
    }
  });

  it("provides a non-empty Russian label for every state", () => {
    for (const [status, label] of Object.entries(RUN_STATUS_LABELS)) {
      expect(status).toBeTruthy();
      expect(label).toMatch(/[А-Яа-яЁё]/u);
    }
  });
});
