import { generateKeyPairSync } from "node:crypto";

import {
  createSourceBinding,
  sourceBindingPublicKeyId,
  verifySourceBinding,
} from "@/application/agent-orchestrator/universal-chat/source-binding";

describe("FastGate source binding", () => {
  it("canonicalizes input/output and verifies an Ed25519 witness independently", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const first = createSourceBinding({
      capabilityKey: "material.getStock",
      requestId: "request-1",
      subjectId: "demo-user-001",
      connector: "SAP",
      resultStatus: "SUCCESS",
      deploymentSha: "a".repeat(40),
      datasetFingerprint: "b".repeat(64),
      input: { warehouseIds: ["WH-B", "WH-A"], materialCode: "MAT-1" },
      output: { rows: [{ quantity: 12, warehouseId: "WH-A" }], snapshotId: "snapshot-7" },
      privateKey,
      publicKey,
    });
    const reordered = createSourceBinding({
      capabilityKey: "material.getStock",
      requestId: "request-1",
      subjectId: "demo-user-001",
      connector: "SAP",
      resultStatus: "SUCCESS",
      deploymentSha: "a".repeat(40),
      datasetFingerprint: "b".repeat(64),
      input: { materialCode: "MAT-1", warehouseIds: ["WH-B", "WH-A"] },
      output: { snapshotId: "snapshot-7", rows: [{ warehouseId: "WH-A", quantity: 12 }] },
      privateKey,
      publicKey,
    });

    expect(first.inputHash).toBe(reordered.inputHash);
    expect(first.outputHash).toBe(reordered.outputHash);
    expect(first).toMatchObject({
      schemaVersion: "agent-source-binding-v1",
      connector: "SAP",
      resultStatus: "SUCCESS",
      canonicalArgumentsHash: first.inputHash,
      sourceProjectionHash: first.outputHash,
    });
    expect(first.sourceBindingHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.publicKeyId).toBe(sourceBindingPublicKeyId(publicKey));
    expect(verifySourceBinding(first, publicKey)).toBe(true);
    expect(verifySourceBinding({ ...first, sourceProjectionHash: "0".repeat(64) }, publicKey)).toBe(false);
    expect(JSON.stringify(first)).not.toContain("private");
  });
});
