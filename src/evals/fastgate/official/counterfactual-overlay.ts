import { createHash } from "node:crypto";

import { canonicalJson, sha256Hex } from "@/evals/fastgate/official/attestation";

const REQUIRED_CASES = ["FG-02", "FG-03", "FG-04", "FG-05", "FG-06", "FG-07", "FG-08", "FG-09", "FG-11"] as const;

interface OverlaySourceRow {
  readonly id: string;
  readonly source: "APPIUS" | "SAP" | "CATALOG" | "NORMATIVE" | "PROCESS";
  readonly snapshotId: string;
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
}

interface PrivateOverlayProof {
  readonly proofId: string;
  readonly caseId: typeof REQUIRED_CASES[number];
  readonly sourceRowIds: readonly string[];
  readonly expectedDisposition: "ANSWER" | "DENY" | "HUMAN_REVIEW_CONFLICT";
  readonly expectedDigest: string;
}

export interface CounterfactualOverlay {
  readonly schemaVersion: "mtr-fastgate-counterfactual-overlay-v1";
  readonly runId: string;
  readonly runNonce: string;
  readonly seed: string;
  readonly scenarioInstant: string;
  readonly datasetVersion: string;
  readonly datasetFingerprint: string;
  readonly coveredCases: readonly typeof REQUIRED_CASES[number][];
  readonly sourceRows: readonly OverlaySourceRow[];
  readonly privateProofIndex: readonly PrivateOverlayProof[];
  readonly publicFixture: Readonly<{
    projectCode: string;
    materialCodes: readonly string[];
    specificationCodes: readonly string[];
  }>;
}

export function buildCounterfactualOverlay(input: Readonly<{
  seed: string;
  runId: string;
  runNonce: string;
}>): CounterfactualOverlay {
  if (!/^[a-f0-9]{64}$/u.test(input.seed)) throw new Error("INVALID_OVERLAY_SEED");
  if (!/^[a-f0-9]{64}$/u.test(input.runNonce)) throw new Error("INVALID_RUN_NONCE");
  const token = deriveToken(input.seed, "fixture", 12).toUpperCase();
  const projectCode = `FG-${token.slice(0, 6)}`;
  const materialCodes = Array.from({ length: 9 }, (_, index) => `FGM-${token.slice(0, 4)}-${String(index + 1).padStart(3, "0")}`);
  const specificationCodes = [`FGS-${token.slice(4, 10)}-01`, `FGS-${token.slice(4, 10)}-02`];
  const sources: OverlaySourceRow["source"][] = ["APPIUS", "SAP", "CATALOG", "NORMATIVE", "PROCESS"];
  const sourceRows = REQUIRED_CASES.map((caseId, index): OverlaySourceRow => Object.freeze({
    id: `row-${deriveToken(input.seed, `${caseId}:row`, 20)}`,
    source: sources[index % sources.length]!,
    snapshotId: `snapshot-${deriveToken(input.seed, `${caseId}:snapshot`, 16)}`,
    payload: Object.freeze({
      projectCode,
      materialCode: materialCodes[index]!,
      quantity: 5 + (Number.parseInt(deriveToken(input.seed, `${caseId}:quantity`, 4), 16) % 96),
      active: true,
    }),
  }));
  const privateProofIndex = REQUIRED_CASES.map((caseId, index): PrivateOverlayProof => Object.freeze({
    proofId: `proof-${deriveToken(input.seed, `${caseId}:proof`, 24)}`,
    caseId,
    sourceRowIds: Object.freeze([sourceRows[index]!.id]),
    expectedDisposition: caseId === "FG-09" ? "HUMAN_REVIEW_CONFLICT" : caseId === "FG-11" ? "DENY" : "ANSWER",
    expectedDigest: sha256Hex(canonicalJson({ caseId, row: sourceRows[index], salt: deriveToken(input.seed, `${caseId}:answer`, 32) })),
  }));
  const publicFixture = Object.freeze({ projectCode, materialCodes: Object.freeze(materialCodes), specificationCodes: Object.freeze(specificationCodes) });
  const datasetVersion = `fastgate-counterfactual-${deriveToken(input.seed, "version", 12)}`;
  const datasetFingerprint = sha256Hex(canonicalJson({ datasetVersion, sourceRows, privateProofIndex }));
  return Object.freeze({
    schemaVersion: "mtr-fastgate-counterfactual-overlay-v1",
    runId: input.runId,
    runNonce: input.runNonce,
    seed: input.seed,
    scenarioInstant: "2026-08-14T12:00:00.000Z",
    datasetVersion,
    datasetFingerprint,
    coveredCases: Object.freeze([...REQUIRED_CASES]),
    sourceRows: Object.freeze(sourceRows),
    privateProofIndex: Object.freeze(privateProofIndex),
    publicFixture,
  });
}

export function projectOverlayForApplication(overlay: CounterfactualOverlay): Readonly<{
  schemaVersion: "mtr-fastgate-application-fixture-v1";
  overlaySeed: string;
  scenarioInstant: string;
  datasetVersion: string;
  publicFixture: CounterfactualOverlay["publicFixture"];
}> {
  return Object.freeze({
    schemaVersion: "mtr-fastgate-application-fixture-v1",
    overlaySeed: overlay.seed,
    scenarioInstant: overlay.scenarioInstant,
    datasetVersion: overlay.datasetVersion,
    publicFixture: overlay.publicFixture,
  });
}

export function validateCounterfactualCoverage(overlay: CounterfactualOverlay): Readonly<{ valid: boolean; missing: readonly string[] }> {
  const sourceIds = new Set(overlay.sourceRows.map((row) => row.id));
  const covered = new Set(overlay.coveredCases);
  const proofCases = new Set(overlay.privateProofIndex.filter((proof) => proof.sourceRowIds.every((id) => sourceIds.has(id))).map((proof) => proof.caseId));
  const missing = REQUIRED_CASES.filter((caseId) => !covered.has(caseId) || !proofCases.has(caseId));
  return Object.freeze({ valid: missing.length === 0, missing: Object.freeze(missing) });
}

function deriveToken(seed: string, label: string, length: number): string {
  return createHash("sha256").update(`${seed}:${label}`).digest("hex").slice(0, length);
}
