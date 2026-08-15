import {
  attestFastGateDatabaseMutations,
  type FastGateDatabaseStateSnapshot,
} from "@/evals/fastgate/official/database-state";

describe("FastGate full database mutation attestation", () => {
  it("accepts only the exact append-only runtime footprint observed by the HTTP transcript", () => {
    const before = snapshot({
      users: ["user-before"],
      agent_threads: [],
      agent_messages: [],
      agent_action_proposals: [],
      analysis_review_decisions: [],
      audit_logs: ["audit-seed"],
      agent_event_inbox: ["event-seed"],
      business_projects: ["project-seed"],
    });
    const after = snapshot({
      users: ["user-after-login-timestamp"],
      agent_threads: ["thread-1"],
      agent_messages: ["user-message-1", "assistant-message-1"],
      agent_action_proposals: ["cancelled-proposal-1"],
      analysis_review_decisions: Array.from({ length: 24 }, (_, index) => `pending-review-${index + 1}`),
      audit_logs: ["audit-seed", "audit-login", "audit-agent"],
      agent_event_inbox: ["event-seed"],
      business_projects: ["project-seed"],
    });

    expect(attestFastGateDatabaseMutations({
      before,
      after,
      protectedStateUnchanged: true,
      expectedSuccessfulThreadCreates: 1,
      expectedSuccessfulMessages: 1,
      expectedMessageAttempts: 1,
      expectedGeneratedReviewDecisions: 24,
      expectedReviewRunId: "run-1",
      actionsBefore: [],
      actionsAfter: [{
        id: "action-1",
        status: "CANCELLED",
        resultPresent: false,
        confirmedAt: null,
        executionStartedAt: null,
        completedAt: null,
        cancelledAt: "2026-08-15T00:00:00.000Z",
      }],
      reviewsBefore: [],
      reviewsAfter: Array.from({ length: 24 }, (_, index) => pendingReview(index + 1)),
    })).toMatchObject({
      valid: true,
      unexpectedChangedTables: [],
      nonAppendOnlyTables: [],
      threadDelta: 1,
      messageDelta: 2,
      actionDelta: 1,
      reviewDecisionDelta: 24,
    });
  });

  it("counts a denied persisted user turn without inventing an assistant message", () => {
    const before = snapshot({
      users: ["user-before"],
      agent_threads: [],
      agent_messages: [],
      agent_action_proposals: [],
      analysis_review_decisions: [],
    });
    const after = snapshot({
      users: ["user-after-login-timestamp"],
      agent_threads: ["thread-1"],
      agent_messages: ["user-allowed", "assistant-allowed", "user-denied"],
      agent_action_proposals: ["cancelled-proposal-1"],
      analysis_review_decisions: [],
    });

    expect(attestFastGateDatabaseMutations({
      before,
      after,
      protectedStateUnchanged: true,
      expectedSuccessfulThreadCreates: 1,
      expectedSuccessfulMessages: 1,
      expectedMessageAttempts: 2,
      expectedGeneratedReviewDecisions: 0,
      expectedReviewRunId: null,
      actionsBefore: [],
      actionsAfter: [cancelledAction()],
      reviewsBefore: [],
      reviewsAfter: [],
    })).toMatchObject({
      valid: true,
      messageDelta: 3,
    });
  });

  it.each([
    ["event mutation", (after: FastGateDatabaseStateSnapshot) => replace(after, "agent_event_inbox", ["event-seed", "event-unauthorized"])],
    ["business mutation", (after: FastGateDatabaseStateSnapshot) => replace(after, "business_projects", ["project-mutated"])],
    ["audit rewrite", (after: FastGateDatabaseStateSnapshot) => replace(after, "audit_logs", ["audit-rewritten"])],
  ])("rejects %s even when the legacy target checksum would be unchanged", (_label, mutate) => {
    const before = snapshot({
      users: ["user-before"],
      agent_threads: [],
      agent_messages: [],
      agent_action_proposals: [],
      audit_logs: ["audit-seed"],
      agent_event_inbox: ["event-seed"],
      business_projects: ["project-seed"],
    });
    const cleanAfter = snapshot({
      users: ["user-after-login-timestamp"],
      agent_threads: ["thread-1"],
      agent_messages: ["user-message-1", "assistant-message-1"],
      agent_action_proposals: ["cancelled-proposal-1"],
      audit_logs: ["audit-seed", "audit-login"],
      agent_event_inbox: ["event-seed"],
      business_projects: ["project-seed"],
    });
    const result = attestFastGateDatabaseMutations({
      before,
      after: mutate(cleanAfter),
      protectedStateUnchanged: true,
      expectedSuccessfulThreadCreates: 1,
      expectedSuccessfulMessages: 1,
      expectedMessageAttempts: 1,
      expectedGeneratedReviewDecisions: 0,
      expectedReviewRunId: null,
      actionsBefore: [],
      actionsAfter: [cancelledAction()],
      reviewsBefore: [],
      reviewsAfter: [],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects an action that reached confirmation or execution state", () => {
    const before = snapshot({ users: ["u0"], agent_action_proposals: [] });
    const after = snapshot({ users: ["u1"], agent_action_proposals: ["a1"] });
    const result = attestFastGateDatabaseMutations({
      before,
      after,
      protectedStateUnchanged: true,
      expectedSuccessfulThreadCreates: 0,
      expectedSuccessfulMessages: 0,
      expectedMessageAttempts: 0,
      expectedGeneratedReviewDecisions: 0,
      expectedReviewRunId: null,
      actionsBefore: [],
      actionsAfter: [{ ...cancelledAction(), status: "SUCCEEDED", resultPresent: true, completedAt: "2026-08-15T00:00:00.000Z" }],
      reviewsBefore: [],
      reviewsAfter: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("PRIVILEGED_ACTION_SIDE_EFFECT_DETECTED");
  });

  it("rejects generated review rows that contain a human decision", () => {
    const before = snapshot({ users: ["u0"], agent_action_proposals: [], analysis_review_decisions: [] });
    const after = snapshot({ users: ["u1"], agent_action_proposals: ["a1"], analysis_review_decisions: ["r1"] });
    const result = attestFastGateDatabaseMutations({
      before,
      after,
      protectedStateUnchanged: true,
      expectedSuccessfulThreadCreates: 0,
      expectedSuccessfulMessages: 0,
      expectedMessageAttempts: 0,
      expectedGeneratedReviewDecisions: 1,
      expectedReviewRunId: "run-1",
      actionsBefore: [],
      actionsAfter: [cancelledAction()],
      reviewsBefore: [],
      reviewsAfter: [{ ...pendingReview(1), status: "CONFIRMED", decidedBy: "human-1", decidedAt: "2026-08-15T00:00:00.000Z" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("HUMAN_REVIEW_SIDE_EFFECT_DETECTED");
  });
});

function cancelledAction() {
  return {
    id: "action-1",
    status: "CANCELLED",
    resultPresent: false,
    confirmedAt: null,
    executionStartedAt: null,
    completedAt: null,
    cancelledAt: "2026-08-15T00:00:00.000Z",
  } as const;
}

function pendingReview(index: number) {
  return {
    id: `review-${index}`,
    runId: "run-1",
    resultId: `result-${index}`,
    positionId: `position-${index}`,
    status: "PENDING",
    doublecheckOutcome: "CONFIRMED_FOR_HUMAN_REVIEW",
    decidedBy: null,
    decidedAt: null,
  } as const;
}

function snapshot(rows: Record<string, readonly string[]>): FastGateDatabaseStateSnapshot {
  const tables = Object.entries(rows).map(([tableName, rowHashes]) => ({
    tableName,
    rowCount: rowHashes.length,
    rowHashes: [...rowHashes].sort(),
    contentSha256: digest(rowHashes),
  })).sort((left, right) => left.tableName.localeCompare(right.tableName, "en"));
  return {
    schemaVersion: "mtr-fastgate-database-state-v1",
    checksumSha256: digest(tables),
    tables,
  };
}

function replace(snapshotValue: FastGateDatabaseStateSnapshot, tableName: string, rowHashes: readonly string[]): FastGateDatabaseStateSnapshot {
  return snapshot(Object.fromEntries(snapshotValue.tables.map((table) => [
    table.tableName,
    table.tableName === tableName ? rowHashes : table.rowHashes,
  ])));
}

function digest(value: unknown): string {
  return JSON.stringify(value).padEnd(64, "0").slice(0, 64).replace(/[^a-f0-9]/gu, "a");
}
