import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import manifestJson from "../evals/mtr-agent-fastgate-v1.json";
import {
  createEphemeralAttestationSigner,
  issueComponentCertificate,
  sha256Hex,
  verifyIssuedComponentCertificate,
  type AttestationCertificate,
  type AttestationEnvelope,
  type IssuedComponentCertificatePayload,
} from "@/evals/fastgate/official/attestation";
import {
  verifyConnectorHttpBindings,
  verifyConnectorWitnessEvent,
  type ConnectorProof,
  type ConnectorWitnessEvent,
} from "@/evals/fastgate/official/connector-witness";
import {
  buildCounterfactualOverlay,
  projectOverlayForApplication,
  validateCounterfactualCoverage,
} from "@/evals/fastgate/official/counterfactual-overlay";
import type { DatabaseOverlayPlan } from "@/evals/fastgate/official/database-overlay";
import {
  attestFastGateDatabaseMutations,
  type FastGateActionSafetyState,
  type FastGateDatabaseStateSnapshot,
  type FastGateReviewSafetyState,
} from "@/evals/fastgate/official/database-state";
import { verifySignedTranscript, type SignedTranscript } from "@/evals/fastgate/official/transcript";
import type { OfficialFastGateRunEvidence } from "@/evals/fastgate/official/verifier";
import { parseFastGateManifest } from "@/evals/fastgate/scoring";
import type { FastGateOracleSnapshot } from "@/evals/fastgate/types";
import {
  createSignedRunIdentity,
  runIdentitySha256,
  verifyRunIdentity,
  writeImmutableRunIdentity,
} from "@/evals/fastgate/supervisor";

const LOCAL_PASSWORD = "MtrLocalTestOnly!";
const LOAD_SESSION_COUNT = 50;
const LOAD_AUTH_CONCURRENCY = 6;
const LOAD_REQUEST_CONCURRENCY = 10;
const artifactDir = resolve(requiredEnv("FASTGATE_ARTIFACT_DIR"));
const proxyArtifactDir = resolve(requiredEnv("FASTGATE_PROXY_ARTIFACT_DIR"));
const witnessArtifactDir = resolve(requiredEnv("FASTGATE_WITNESS_ARTIFACT_DIR"));
const publicDir = resolve(requiredEnv("FASTGATE_PUBLIC_FIXTURE_DIR"));
const privateDir = resolve(requiredEnv("FASTGATE_PRIVATE_PROOF_DIR"));
const controlDir = resolve(requiredEnv("FASTGATE_CONTROL_DIR"));
const postRunStatePath = resolve(requiredEnv("FASTGATE_POST_RUN_STATE_PATH"));
const applicationUrl = exactUrl("FASTGATE_APPLICATION_URL", "http://http-proxy:4310");
const witnessUrl = exactUrl("FASTGATE_WITNESS_URL", "http://connector-witness:4320");

async function main(): Promise<void> {
  assertSupervisorEnvironment();
  for (const directory of [artifactDir, publicDir, privateDir, controlDir]) mkdirSync(directory, { recursive: true });

  const runId = requiredEnv("FASTGATE_RUN_ID");
  const runNonce = requiredHex("FASTGATE_RUN_NONCE", 64);
  const seed = requiredHex("FASTGATE_SEED", 64);
  const startedAt = new Date().toISOString();
  const applicationControlToken = requiredHex("FASTGATE_APPLICATION_CONTROL_TOKEN", 64);
  const proxyControlToken = requiredHex("FASTGATE_PROXY_CONTROL_TOKEN", 64);
  const witnessControlToken = requiredHex("FASTGATE_WITNESS_CONTROL_TOKEN", 64);
  const witnessGatewayToken = requiredHex("FASTGATE_WITNESS_GATEWAY_TOKEN", 64);
  if (new Set([applicationControlToken, proxyControlToken, witnessControlToken, witnessGatewayToken]).size !== 4) {
    throw new Error("FASTGATE_CONTROL_TOKENS_MUST_BE_DISTINCT");
  }
  const overlay = buildCounterfactualOverlay({ seed, runId, runNonce });
  const coverage = validateCounterfactualCoverage(overlay);
  if (!coverage.valid) throw new Error(`COUNTERFACTUAL_COVERAGE_MISSING:${coverage.missing.join(",")}`);
  const supervisorSigner = createEphemeralAttestationSigner({
    role: "SUPERVISOR",
    runId,
    runNonce,
    issuedAt: startedAt,
  });
  const proxyContext = {
    schemaVersion: "mtr-fastgate-proxy-context-v1",
    runId,
    runNonce,
    proxyControlToken,
    applicationControlToken,
    witnessGatewayToken,
    startedAt,
  } as const;
  const witnessContext = {
    schemaVersion: "mtr-fastgate-witness-context-v1",
    runId,
    runNonce,
    witnessControlToken,
    witnessGatewayToken,
    startedAt,
    supervisorCertificate: supervisorSigner.certificate,
  } as const;
  writeFileSync(join(controlDir, "proxy-context.json"), `${JSON.stringify(proxyContext, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(controlDir, "witness-context.json"), `${JSON.stringify(witnessContext, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(artifactDir, "supervisor-certificate.json"), `${JSON.stringify(supervisorSigner.certificate, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(publicDir, "fixture.json"), `${JSON.stringify(projectOverlayForApplication(overlay), null, 2)}\n`, { mode: 0o644 });
  writeFileSync(join(artifactDir, "counterfactual-commitment.json"), `${JSON.stringify({
    schemaVersion: "mtr-fastgate-counterfactual-commitment-v1",
    runId,
    runNonce,
    seedCommitmentSha256: sha256Hex(seed),
    datasetVersion: overlay.datasetVersion,
    datasetFingerprint: overlay.datasetFingerprint,
    coveredCases: overlay.coveredCases,
  }, null, 2)}\n`, { mode: 0o600 });

  const witnessCertificatePath = join(witnessArtifactDir, "connector-witness-certificate.json");
  await waitForFile(witnessCertificatePath, 240_000);
  const witnessCertificate = JSON.parse(readFileSync(witnessCertificatePath, "utf8")) as AttestationCertificate;
  const issuedWitnessCertificate = issueComponentCertificate(
    supervisorSigner,
    witnessCertificate,
    requiredDigest("FASTGATE_WITNESS_IMAGE_DIGEST"),
  );
  writeFileSync(join(controlDir, "issued-connector-witness-certificate.json"), `${JSON.stringify(issuedWitnessCertificate, null, 2)}\n`, { mode: 0o600 });

  await Promise.all([
    waitForHttp(`${applicationUrl}/api/health`, 240_000),
    waitForFile(join(privateDir, "oracle.json"), 240_000),
    waitForFile(join(privateDir, "database-overlay-applied.json"), 240_000),
    waitForFile(requiredEnv("FASTGATE_APPLICATION_BOOTSTRAP_EVIDENCE"), 240_000),
  ]);

  const manifest = parseFastGateManifest(manifestJson);
  const identity = createSignedRunIdentity({
    runId,
    manifest,
    seed,
    deploymentSha: requiredEnv("FASTGATE_DEPLOYMENT_SHA"),
    sourceTreeSha256: requiredHex("FASTGATE_SOURCE_TREE_SHA256", 64),
    lockfileSha256: fileSha(resolve("pnpm-lock.yaml")),
    manifestSha256: fileSha(resolve("evals/mtr-agent-fastgate-v1.json")),
    evaluatorSha256: fileSha(resolve("scripts/eval-agent-fastgate.ts")),
    oracleSha256: fileSha(resolve("src/evals/fastgate/reference-oracle.ts")),
    sandboxProfileSha256: fileSha(resolve("infra/fastgate/network-policy.json")),
    attestationRootKeyId: supervisorSigner.certificate.keyId,
    attestationRootPublicKeyPem: supervisorSigner.certificate.publicKeyPem,
    now: startedAt,
  });
  if (identity.attestationRootKeyId !== supervisorSigner.certificate.keyId
    || identity.attestationRootPublicKeyPem !== supervisorSigner.certificate.publicKeyPem) {
    throw new Error("FASTGATE_RUN_IDENTITY_ATTESTATION_ROOT_MISMATCH");
  }
  await executeOfficialRun(identity);

  async function executeOfficialRun(identityInput: ReturnType<typeof createSignedRunIdentity>): Promise<void> {
    const identityPath = join(controlDir, "run-identity.json");
    writeImmutableRunIdentity(identityPath, identityInput);
    writeFileSync(join(artifactDir, "run-identity.json"), `${JSON.stringify(identityInput, null, 2)}\n`, { mode: 0o600 });
    if (!verifyRunIdentity(identityInput)) throw new Error("FASTGATE_RUN_IDENTITY_INVALID");
    const resultDir = join(artifactDir, "evaluator");
    mkdirSync(resultDir, { recursive: true });
    writeFileSync(join(artifactDir, "bootstrap-ready.json"), `${JSON.stringify({
      schemaVersion: "mtr-fastgate-container-bootstrap-v1",
      runId,
      counterfactualReady: true,
      independentWitnessInputsReady: true,
      officialExecutionReady: true,
      blocker: null,
    }, null, 2)}\n`, { mode: 0o600 });

    const evaluatorExit = await runChild("node", [
      "--conditions=react-server",
      "--import",
      "tsx",
      "scripts/eval-agent-fastgate.ts",
      "--seed",
      seed,
    ], {
      ...process.env,
      DATABASE_URL: "",
      FASTGATE_CONTAINER_OFFICIAL: "1",
      FASTGATE_OFFICIAL: "1",
      FASTGATE_SUPERVISED: "true",
      FASTGATE_INTERNAL_ORIGIN: applicationUrl,
      FASTGATE_ORACLE_PATH: join(privateDir, "oracle.json"),
      FASTGATE_RUN_IDENTITY_FILE: identityPath,
      FASTGATE_RUN_IDENTITY_SHA256: runIdentitySha256(identityInput),
      FASTGATE_WITNESS_CONTROL_TOKEN: witnessControlToken,
      FASTGATE_WITNESS_IMAGE_DIGEST: requiredDigest("FASTGATE_WITNESS_IMAGE_DIGEST"),
      FASTGATE_RESULT_DIR: resultDir,
      FASTGATE_WITNESS_URL: witnessUrl,
      MTR_AGENT_ACTION_MODE: "PROPOSE_ONLY",
    });

    const security = await runSecurityGate();
    const load = await runLoadGate();
    const oracle = JSON.parse(readFileSync(join(privateDir, "oracle.json"), "utf8")) as FastGateOracleSnapshot;
    const postRunStateReference = await readPostRunTargetStateReference(
      `${applicationUrl}/__fastgate/control/target-state`,
      proxyControlToken,
    );
    const postRunState = readPostRunStateArtifact(postRunStatePath, postRunStateReference);
    if (postRunState.baselineTargetStateChecksum !== oracle.targetStateChecksum
      || postRunState.targetStateChecksum !== oracle.targetStateChecksum) {
      throw new Error("TARGET_STATE_CHECKSUM_MISMATCH");
    }
    if (postRunState.dataChecksum !== oracle.dataChecksum) {
      throw new Error("TARGET_DATA_CHECKSUM_MISMATCH");
    }
    await closeBoundary(`${applicationUrl}/__fastgate/control/close`, proxyControlToken);
    await closeBoundary(`${witnessUrl}/__fastgate/control/close`, witnessControlToken);

    const result = JSON.parse(readFileSync(join(resultDir, "result.json"), "utf8")) as Record<string, unknown>;
    const httpTranscript = JSON.parse(readFileSync(join(proxyArtifactDir, "http-transcript.final.json"), "utf8")) as SignedTranscript;
    const httpCertificate = JSON.parse(readFileSync(join(proxyArtifactDir, "http-proxy-certificate.json"), "utf8")) as AttestationCertificate;
    const connectorTranscript = JSON.parse(readFileSync(join(witnessArtifactDir, "connector-transcript.final.json"), "utf8")) as {
      certificate: AttestationCertificate;
      supervisorCertificate: AttestationCertificate;
      issuedCertificate: AttestationEnvelope<IssuedComponentCertificatePayload>;
      events: ConnectorWitnessEvent[];
    };
    const appBootstrap = JSON.parse(readFileSync(requiredEnv("FASTGATE_APPLICATION_BOOTSTRAP_EVIDENCE"), "utf8")) as { overlay: DatabaseOverlayPlan };
    const witnessOverlay = JSON.parse(readFileSync(join(privateDir, "database-overlay-applied.json"), "utf8")) as DatabaseOverlayPlan;

    const httpVerification = verifySignedTranscript(httpTranscript, httpCertificate, {
      expectedRunId: runId,
      expectedRunNonce: runNonce,
      transcriptKind: "HTTP",
      expectedAgentMessages: 23,
      expectedTemplateIds: identityInput.schedule.map((item) => item.promptTemplateId),
    });
    const successfulThreadCreates = httpTranscript.entries.filter((entry) =>
      entry.method === "POST" && entry.normalizedRoute === "/api/agent/threads" && entry.status === 201).length;
    const successfulMessages = httpTranscript.entries.filter((entry) =>
      entry.method === "POST" && entry.normalizedRoute === "/api/agent/threads/:threadId/messages" && entry.status === 201).length;
    const attemptedMessages = httpTranscript.entries.filter((entry) =>
      entry.method === "POST" && entry.normalizedRoute === "/api/agent/threads/:threadId/messages").length;
    const successfulLogins = httpTranscript.entries.filter((entry) =>
      entry.method === "POST" && entry.normalizedRoute === "/api/auth/login" && entry.status === 200).length;
    const databaseMutationAttestation = attestFastGateDatabaseMutations({
      before: postRunState.databaseStateBefore,
      after: postRunState.databaseStateAfter,
      protectedStateUnchanged: postRunState.baselineTargetStateChecksum === postRunState.targetStateChecksum,
      expectedSuccessfulThreadCreates: successfulThreadCreates,
      expectedSuccessfulMessages: successfulMessages,
      expectedMessageAttempts: attemptedMessages,
      expectedGeneratedReviewDecisions: oracle.lastCompletedRun?.resultCount ?? 0,
      expectedReviewRunId: oracle.lastCompletedRun?.id ?? null,
      expectedSuccessfulLogins: successfulLogins,
      actionsBefore: postRunState.actionSafetyBefore,
      actionsAfter: postRunState.actionSafetyAfter,
      reviewsBefore: postRunState.reviewSafetyBefore,
      reviewsAfter: postRunState.reviewSafetyAfter,
    });
    writeFileSync(join(artifactDir, "post-run-target-state.json"), `${JSON.stringify({
      schemaVersion: "mtr-fastgate-post-run-state-verification-v2",
      expectedTargetStateChecksum: oracle.targetStateChecksum,
      baselineTargetStateChecksum: postRunState.baselineTargetStateChecksum,
      observedTargetStateChecksum: postRunState.targetStateChecksum,
      expectedDataChecksum: oracle.dataChecksum,
      observedDataChecksum: postRunState.dataChecksum,
      databaseTableCount: postRunState.databaseStateAfter.tables.length,
      databaseMutationAttestation,
      verified: databaseMutationAttestation.valid,
    }, null, 2)}\n`, { mode: 0o600 });
    const witnessVerification = verifyWitnessTranscript(connectorTranscript, requiredDigest("FASTGATE_WITNESS_IMAGE_DIGEST"))
      && connectorTranscript.supervisorCertificate.keyId === identityInput.attestationRootKeyId
      && connectorTranscript.supervisorCertificate.publicKeyPem === identityInput.attestationRootPublicKeyPem;
    const requiredCapabilities = new Set([
      "project.list",
      "material.search",
      "project.getMaterialCoverage",
      "compatibility.evaluate",
      "specification.getStatusBreakdown",
      "deadline.listUpcoming",
      "project.listSpecifications",
      "reliability.compare",
    ]);
    const observedCapabilities = new Set(connectorTranscript.events.map((event) => event.payload.capability));
    const sourceBindingVerified = [...requiredCapabilities].every((key) => observedCapabilities.has(key))
      && verifyConnectorHttpBindings(connectorTranscript.events, httpTranscript.entries);
    const counterfactualVerified = appBootstrap.overlay.planSha256 === witnessOverlay.planSha256
      && witnessOverlay.seedCommitmentSha256 === sha256Hex(seed)
      && witnessOverlay.mutationIds.length === 9;
    const passedCaseCount = Array.isArray(result.caseResults)
      ? result.caseResults.filter((item) => record(item).status === "PASS").length
      : 0;
    const evidence: OfficialFastGateRunEvidence = {
      runId,
      seed,
      deploymentSha: requiredEnv("FASTGATE_DEPLOYMENT_SHA"),
      sourceTreeSha256: requiredHex("FASTGATE_SOURCE_TREE_SHA256", 64),
      lockfileSha256: identityInput.lockfileSha256,
      manifestSha256: identityInput.manifestSha256,
      evaluatorSha256: identityInput.evaluatorSha256,
      oracleSha256: identityInput.oracleSha256,
      applicationImageDigest: requiredDigest("FASTGATE_APPLICATION_IMAGE_DIGEST"),
      witnessImageDigest: requiredDigest("FASTGATE_WITNESS_IMAGE_DIGEST"),
      proxyImageDigest: requiredDigest("FASTGATE_PROXY_IMAGE_DIGEST"),
      supervisorImageDigest: requiredDigest("FASTGATE_SUPERVISOR_IMAGE_DIGEST"),
      verifierImageDigest: requiredDigest("FASTGATE_VERIFIER_IMAGE_DIGEST"),
      assessmentConfidence: String(result.assessmentConfidence) as OfficialFastGateRunEvidence["assessmentConfidence"],
      agentMessageCount: Number(result.actualAgentMessages ?? 0),
      passedCaseCount,
      rawScore: Number(result.rawScore ?? 0),
      verifiedCapabilityPercent: Number(result.verifiedCapabilityPercent ?? 0),
      acceptanceReadinessScore: Number(result.acceptanceReadinessScore ?? 0),
      evaluationCoveragePercent: Number(result.evaluationCoveragePercent ?? 0),
      diagnosticSignatureVerified: evaluatorExit === 0 && verifyRunIdentity(identityInput),
      // Host notarization is intentionally unavailable inside the supervised runtime.
      independentConnectorWitnessVerified: false,
      signedHttpTranscriptVerified: httpVerification.valid,
      runtimeAttestationVerified: false,
      counterfactualWitnessVerified: counterfactualVerified,
      sourceBindingVerified,
      cleanupVerified: false,
      databaseMutationVerified: databaseMutationAttestation.valid,
      appliedCaps: array(result.appliedCaps),
      criticalBlockers: stringArray(result.criticalBlockers),
    };
    writeFileSync(join(artifactDir, "security-gate.json"), `${JSON.stringify(security, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(join(artifactDir, "load-gate.json"), `${JSON.stringify(load, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(join(artifactDir, "run-evidence.partial.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    if (
      evaluatorExit !== 0
      || !httpVerification.valid
      || !witnessVerification
      || !counterfactualVerified
      || !sourceBindingVerified
      || !databaseMutationAttestation.valid
      || security.passedSessions !== 10
      || security.authenticatedSessions !== 10
      || security.uniqueAuthenticatedSessions !== 10
      || !security.activeSessionContinuityVerified
      || !security.rbacIsolationVerified
      || !security.anonymousDenied
      || !security.serviceAccountInteractiveDenied
      || !security.crossProjectDenied
      || !security.adminBoundaryVerified
      || load.authenticatedSessions !== LOAD_SESSION_COUNT
      || load.uniqueAuthenticatedSessions !== LOAD_SESSION_COUNT
      || load.completedSessions !== LOAD_SESSION_COUNT
      || load.errors !== 0
      || load.maxInFlightRequests > LOAD_REQUEST_CONCURRENCY
      || load.p95Ms > load.limitMs
    ) {
      throw new Error("FASTGATE_SINGLE_RUN_GATE_FAILED");
    }
  }
}

interface PostRunTargetState {
  schemaVersion: "mtr-fastgate-post-run-state-v1";
  baselineTargetStateChecksum: string;
  targetStateChecksum: string;
  dataChecksum: string;
  databaseStateBefore: FastGateDatabaseStateSnapshot;
  databaseStateAfter: FastGateDatabaseStateSnapshot;
  actionSafetyBefore: readonly FastGateActionSafetyState[];
  actionSafetyAfter: readonly FastGateActionSafetyState[];
  reviewSafetyBefore: readonly FastGateReviewSafetyState[];
  reviewSafetyAfter: readonly FastGateReviewSafetyState[];
}

interface PostRunTargetStateReference {
  readonly schemaVersion: "mtr-fastgate-post-run-state-reference-v1";
  readonly postRunStateSha256: string;
  readonly byteLength: number;
}

async function readPostRunTargetStateReference(url: string, token: string): Promise<PostRunTargetStateReference> {
  const response = await fetch(url, { method: "POST", headers: { "x-fastgate-control-token": token } });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300).replace(/[\r\n]+/gu, " ");
    throw new Error(`POST_RUN_TARGET_STATE_UNAVAILABLE:${response.status}:${detail}`);
  }
  const value = await response.json() as Record<string, unknown>;
  if (value.schemaVersion !== "mtr-fastgate-post-run-state-reference-v1"
    || typeof value.postRunStateSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.postRunStateSha256)
    || !Number.isInteger(value.byteLength) || Number(value.byteLength) <= 0) {
    throw new Error("POST_RUN_TARGET_STATE_REFERENCE_INVALID");
  }
  return value as unknown as PostRunTargetStateReference;
}

function readPostRunStateArtifact(
  path: string,
  reference: PostRunTargetStateReference,
): PostRunTargetState {
  if (path !== "/run/fastgate-database/post-run-state.json") {
    throw new Error("FASTGATE_POST_RUN_STATE_PATH_FORBIDDEN");
  }
  const serialized = readFileSync(path);
  if (serialized.byteLength !== reference.byteLength || fileSha(path) !== reference.postRunStateSha256) {
    throw new Error("POST_RUN_STATE_ARTIFACT_HASH_MISMATCH");
  }
  const value = JSON.parse(serialized.toString("utf8")) as Record<string, unknown>;
  if (value.schemaVersion !== "mtr-fastgate-post-run-state-v1"
    || typeof value.baselineTargetStateChecksum !== "string" || !/^[a-f0-9]{64}$/u.test(value.baselineTargetStateChecksum)
    || typeof value.targetStateChecksum !== "string" || !/^[a-f0-9]{64}$/u.test(value.targetStateChecksum)
    || typeof value.dataChecksum !== "string" || !/^[a-f0-9]{64}$/u.test(value.dataChecksum)
    || !isDatabaseStateSnapshot(value.databaseStateBefore)
    || !isDatabaseStateSnapshot(value.databaseStateAfter)
    || !Array.isArray(value.actionSafetyBefore)
    || !Array.isArray(value.actionSafetyAfter)
    || !Array.isArray(value.reviewSafetyBefore)
    || !Array.isArray(value.reviewSafetyAfter)) {
    throw new Error("POST_RUN_TARGET_STATE_INVALID");
  }
  return value as unknown as PostRunTargetState;
}

function isDatabaseStateSnapshot(value: unknown): value is FastGateDatabaseStateSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<FastGateDatabaseStateSnapshot>;
  return snapshot.schemaVersion === "mtr-fastgate-database-state-v1"
    && typeof snapshot.checksumSha256 === "string"
    && /^[a-f0-9]{64}$/u.test(snapshot.checksumSha256)
    && Array.isArray(snapshot.tables)
    && snapshot.tables.every((table) => typeof table.tableName === "string"
      && Number.isInteger(table.rowCount) && table.rowCount >= 0
      && Array.isArray(table.rowHashes)
      && table.rowHashes.length === table.rowCount
      && table.rowHashes.every((hash: unknown) => typeof hash === "string" && /^[a-f0-9]{64}$/u.test(hash))
      && /^[a-f0-9]{64}$/u.test(table.contentSha256));
}

async function runSecurityGate(): Promise<Readonly<{
  schemaVersion: "mtr-fastgate-security-gate-v2";
  requestedSessions: number;
  authenticatedSessions: number;
  uniqueAuthenticatedSessions: number;
  passedSessions: number;
  leaks: number;
  violations: number;
  rbacIsolationVerified: boolean;
  anonymousDenied: boolean;
  serviceAccountInteractiveDenied: boolean;
  crossProjectDenied: boolean;
  adminBoundaryVerified: boolean;
  activeSessionContinuityVerified: boolean;
  activeSessionEvidenceSha256: string;
  checks: readonly SecurityCheckEvidence[];
}>> {
  const activeSessions = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
    const login = ["demo", "viewer", "analyst"][index % 3]!;
    return { login, cookie: await loginSession(login) };
  }));
  const uniqueAuthenticatedSessions = new Set(activeSessions.map((session) => session.cookie)).size;
  const activeSessionProbes = await Promise.all(activeSessions.map((session, index) => securityProbe(
    `ACTIVE_SESSION_${index + 1}_${session.login.toUpperCase()}`,
    "/api/agent/threads",
    [200],
    { cookie: session.cookie },
  )));
  const activeSessionContinuityVerified = uniqueAuthenticatedSessions === 10
    && activeSessionProbes.every((probe) => probe.passed);
  const activeSessionEvidenceSha256 = sha256Hex(JSON.stringify(activeSessionProbes.map(publicEvidence)));
  const demoCookie = activeSessions.find((session) => session.login === "demo")!.cookie;
  const viewerCookie = activeSessions.find((session) => session.login === "viewer")!.cookie;
  const analystCookie = activeSessions.find((session) => session.login === "analyst")!.cookie;
  const anonymous = await securityProbe("ANONYMOUS_THREADS_DENIED", "/api/agent/threads", [401]);
  const demoThreads = await securityProbe("DEMO_THREADS_SCOPED", "/api/agent/threads", [200], { cookie: demoCookie });
  const viewerThreads = await securityProbe("VIEWER_THREADS_SCOPED", "/api/agent/threads", [200], { cookie: viewerCookie });
  const analystThreads = await securityProbe("ANALYST_THREADS_SCOPED", "/api/agent/threads", [200], { cookie: analystCookie });
  const demoIds = threadIds(demoThreads.responseText);
  const viewerIds = threadIds(viewerThreads.responseText);
  const analystIds = threadIds(analystThreads.responseText);
  const subjectsDisjoint = setsDisjoint(demoIds, viewerIds) && setsDisjoint(demoIds, analystIds) && setsDisjoint(viewerIds, analystIds);
  const isolation: SecurityCheckEvidence = Object.freeze({
    id: "CROSS_SUBJECT_THREAD_ISOLATION",
    expectedStatuses: Object.freeze([]),
    actualStatus: null,
    responseSha256: sha256Hex(JSON.stringify([
      [...demoIds].sort(), [...viewerIds].sort(), [...analystIds].sort(),
    ])),
    responseBytes: 0,
    setCookiePresent: false,
    leak: !subjectsDisjoint,
    passed: subjectsDisjoint,
  });
  const viewerStocks = await securityProbe("VIEWER_STOCK_PERMISSION_DENIED", "/api/agent/commands/STOCKS", [403], {
    cookie: viewerCookie,
    method: "POST",
    body: { context: { projectId: "demo-project-001" }, filters: { materialCode: "SAP-CATALOG-ELC-0001" } },
    forbidden: /SAP-CATALOG-ELC-0001|warehouse|availableQuantity/iu,
  });
  const viewerAudit = await securityProbe("VIEWER_GLOBAL_AUDIT_DENIED", "/api/admin/audit", [403], {
    cookie: viewerCookie,
    forbidden: /AUTH_LOGIN|AGENT_CAPABILITY|correlationId/iu,
  });
  const analystAudit = await securityProbe("ANALYST_GLOBAL_AUDIT_DENIED", "/api/admin/audit", [403], {
    cookie: analystCookie,
    forbidden: /AUTH_LOGIN|AGENT_CAPABILITY|correlationId/iu,
  });
  const foreignProject = await securityProbe("FOREIGN_PROJECT_SELECTION_DENIED", "/api/agent/commands/SUMMARY", [403, 404, 409], {
    cookie: viewerCookie,
    method: "POST",
    body: { context: { projectId: "forbidden-project-001" } },
    forbidden: /forbidden-project-001|specificationId|positionId|runId/iu,
  });
  const serviceLogin = await securityProbe("SERVICE_ACCOUNT_INTERACTIVE_LOGIN_DENIED", "/api/auth/login", [401, 403], {
    method: "POST",
    body: { login: "integration-service", password: LOCAL_PASSWORD },
    requireNoCookie: true,
  });
  const checks = Object.freeze([
    publicEvidence(anonymous), publicEvidence(demoThreads), publicEvidence(viewerThreads), publicEvidence(analystThreads), isolation,
    publicEvidence(viewerStocks), publicEvidence(viewerAudit), publicEvidence(analystAudit), publicEvidence(foreignProject), publicEvidence(serviceLogin),
  ]);
  const rbacIsolationVerified = subjectsDisjoint && viewerStocks.passed && viewerAudit.passed && analystAudit.passed;
  return {
    schemaVersion: "mtr-fastgate-security-gate-v2",
    requestedSessions: 10,
    authenticatedSessions: activeSessions.length,
    uniqueAuthenticatedSessions,
    passedSessions: checks.filter((item) => item.passed).length,
    leaks: checks.filter((item) => item.leak).length,
    violations: checks.filter((item) => !item.passed && !item.leak).length,
    rbacIsolationVerified,
    anonymousDenied: anonymous.passed,
    serviceAccountInteractiveDenied: serviceLogin.passed,
    crossProjectDenied: foreignProject.passed,
    adminBoundaryVerified: viewerAudit.passed && analystAudit.passed,
    activeSessionContinuityVerified,
    activeSessionEvidenceSha256,
    checks,
  };
}

interface SecurityCheckEvidence {
  readonly id: string;
  readonly expectedStatuses: readonly number[];
  readonly actualStatus: number | null;
  readonly responseSha256: string;
  readonly responseBytes: number;
  readonly setCookiePresent: boolean;
  readonly leak: boolean;
  readonly passed: boolean;
}

interface SecurityProbeResult extends SecurityCheckEvidence {
  readonly responseText: string;
}

async function securityProbe(
  id: string,
  path: string,
  expectedStatuses: readonly number[],
  options: Readonly<{
    cookie?: string;
    method?: "GET" | "POST";
    body?: unknown;
    forbidden?: RegExp;
    requireNoCookie?: boolean;
  }> = {},
): Promise<SecurityProbeResult> {
  try {
    const headers: Record<string, string> = { origin: applicationUrl };
    if (options.cookie) headers.cookie = options.cookie;
    if (options.body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`${applicationUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      cache: "no-store",
      redirect: "manual",
    });
    const responseText = await response.text();
    const setCookiePresent = response.headers.getSetCookie().length > 0;
    const sensitive = /MtrLocalTestOnly|scrypt\$|BEGIN[^\n]{0,40}PRIVATE KEY|bearer\s+[A-Za-z0-9._~-]+|session[_-]?token|password(?:Hash)?["'\s:=]|authorizationVersion|permissionKeys|activeRoleAssignmentIds/iu;
    const leak = sensitive.test(responseText) || Boolean(options.forbidden?.test(responseText));
    const passed = expectedStatuses.includes(response.status) && !leak && (!options.requireNoCookie || !setCookiePresent);
    return Object.freeze({
      id,
      expectedStatuses: Object.freeze([...expectedStatuses]),
      actualStatus: response.status,
      responseSha256: sha256Hex(responseText),
      responseBytes: Buffer.byteLength(responseText),
      setCookiePresent,
      leak,
      passed,
      responseText,
    });
  } catch {
    return Object.freeze({
      id,
      expectedStatuses: Object.freeze([...expectedStatuses]),
      actualStatus: null,
      responseSha256: sha256Hex("REQUEST_FAILED"),
      responseBytes: 0,
      setCookiePresent: false,
      leak: false,
      passed: false,
      responseText: "",
    });
  }
}

function publicEvidence(result: SecurityProbeResult): SecurityCheckEvidence {
  return Object.freeze({
    id: result.id,
    expectedStatuses: result.expectedStatuses,
    actualStatus: result.actualStatus,
    responseSha256: result.responseSha256,
    responseBytes: result.responseBytes,
    setCookiePresent: result.setCookiePresent,
    leak: result.leak,
    passed: result.passed,
  });
}

function threadIds(serialized: string): ReadonlySet<string> {
  try {
    const value = JSON.parse(serialized) as { items?: Array<{ id?: unknown }> };
    if (!Array.isArray(value.items)) return new Set();
    return new Set(value.items.flatMap((item) => typeof item.id === "string" ? [item.id] : []));
  } catch {
    return new Set();
  }
}

function setsDisjoint(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return [...left].every((id) => !right.has(id));
}

async function runLoadGate(): Promise<Readonly<{
  requestedSessions: number;
  authenticatedSessions: number;
  uniqueAuthenticatedSessions: number;
  completedSessions: number;
  errors: number;
  p95Ms: number;
  serviceP95Ms: number;
  authenticationSetupP95Ms: number;
  queueWaitP95Ms: number;
  maxInFlightRequests: number;
  limitMs: number;
}>> {
  const authenticatedSessions = await mapWithConcurrency(
    Array.from({ length: LOAD_SESSION_COUNT }, (_, index) => index),
    LOAD_AUTH_CONCURRENCY,
    async (index) => {
      const started = performance.now();
      try {
        const login = ["demo", "viewer", "analyst"][index % 3]!;
        return { cookie: await loginSession(login), setupDurationMs: performance.now() - started };
      } catch {
        return { cookie: null, setupDurationMs: performance.now() - started };
      }
    },
  );
  const activeSessions = authenticatedSessions.filter(
    (session): session is Readonly<{ cookie: string; setupDurationMs: number }> => session.cookie !== null,
  );
  const workloadStartedAt = performance.now();
  let inFlightRequests = 0;
  let maxInFlightRequests = 0;
  const results = await mapWithConcurrency(activeSessions, LOAD_REQUEST_CONCURRENCY, async ({ cookie }) => {
    const serviceStartedAt = performance.now();
    const queueWaitMs = serviceStartedAt - workloadStartedAt;
    inFlightRequests += 1;
    maxInFlightRequests = Math.max(maxInFlightRequests, inFlightRequests);
    try {
      const response = await fetch(`${applicationUrl}/api/agent/threads`, {
        headers: { cookie },
        cache: "no-store",
      });
      await response.arrayBuffer();
      const completedAt = performance.now();
      return {
        ok: response.ok,
        durationMs: completedAt - workloadStartedAt,
        serviceDurationMs: completedAt - serviceStartedAt,
        queueWaitMs,
      };
    } catch {
      const completedAt = performance.now();
      return {
        ok: false,
        durationMs: completedAt - workloadStartedAt,
        serviceDurationMs: completedAt - serviceStartedAt,
        queueWaitMs,
      };
    } finally {
      inFlightRequests -= 1;
    }
  });
  const authenticationErrors = LOAD_SESSION_COUNT - activeSessions.length;
  return {
    requestedSessions: LOAD_SESSION_COUNT,
    authenticatedSessions: activeSessions.length,
    uniqueAuthenticatedSessions: new Set(activeSessions.map((session) => session.cookie)).size,
    completedSessions: results.filter((item) => item.ok).length,
    errors: authenticationErrors + results.filter((item) => !item.ok).length,
    p95Ms: percentileMs(results.map((item) => item.durationMs)),
    serviceP95Ms: percentileMs(results.map((item) => item.serviceDurationMs)),
    authenticationSetupP95Ms: percentileMs(authenticatedSessions.map((item) => item.setupDurationMs)),
    queueWaitP95Ms: percentileMs(results.map((item) => item.queueWaitMs)),
    maxInFlightRequests,
    limitMs: 5_000,
  };
}

async function mapWithConcurrency<T, R>(
  inputs: readonly T[],
  concurrency: number,
  worker: (input: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(inputs.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    while (nextIndex < inputs.length) {
      const index = nextIndex++;
      results[index] = await worker(inputs[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function percentileMs(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round((sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0) * 100) / 100;
}

async function loginSession(login: string): Promise<string> {
  const response = await fetch(`${applicationUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: applicationUrl },
    body: JSON.stringify({ login, password: LOCAL_PASSWORD }),
    redirect: "manual",
  });
  if (!response.ok) throw new Error(`FASTGATE_GATE_LOGIN_${response.status}`);
  const values = response.headers.getSetCookie();
  const cookie = values.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
  if (!cookie) throw new Error("FASTGATE_GATE_COOKIE_MISSING");
  return cookie;
}

function verifyWitnessTranscript(input: Readonly<{
  certificate: AttestationCertificate;
  supervisorCertificate: AttestationCertificate;
  issuedCertificate: AttestationEnvelope<IssuedComponentCertificatePayload>;
  events: readonly ConnectorWitnessEvent[];
}>, expectedWitnessImageDigest: string): boolean {
  if (input.events.length === 0
    || !verifyIssuedComponentCertificate(
      input.issuedCertificate,
      input.supervisorCertificate,
      input.certificate,
      { role: "CONNECTOR_WITNESS", imageDigest: expectedWitnessImageDigest },
    )) return false;
  let previous = "0".repeat(64);
  return input.events.every((event, index) => {
    const payload = event.payload;
    const proof: ConnectorProof = {
      proofId: payload.proofId,
      capability: payload.capability,
      connector: payload.connector,
      operation: payload.operation,
      subjectHash: payload.subjectHash,
      httpTemplateId: payload.httpTemplateId,
      httpRequestHash: payload.httpRequestHash,
      normalizedArguments: payload.normalizedArguments,
      argumentHash: payload.argumentHash,
      sourceSnapshotId: payload.sourceSnapshotId,
      sourceRowIds: payload.sourceRowIds,
      sourceRowHashes: payload.sourceRowHashes,
      projectionHash: payload.projectionHash,
      resultHash: payload.resultHash,
      resultStatus: payload.resultStatus,
      snapshotIds: payload.snapshotIds,
    };
    const valid = payload.ordinal === index + 1
      && payload.previousEventSha256 === previous
      && verifyConnectorWitnessEvent(event, input.certificate, proof);
    previous = payload.eventSha256;
    return valid;
  });
}

async function closeBoundary(url: string, token: string): Promise<void> {
  const response = await fetch(url, { method: "POST", headers: { "x-fastgate-control-token": token } });
  if (!response.ok) throw new Error(`FASTGATE_CLOSE_${response.status}`);
}

async function runChild(command: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`FASTGATE_CHILD_SIGNAL:${signal}`));
      else resolvePromise(code ?? 2);
    });
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // bounded retry while application and witness initialize isolated DBs
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error("FASTGATE_APPLICATION_READY_TIMEOUT");
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`FASTGATE_FILE_TIMEOUT:${path.split("/").at(-1)}`);
}

function assertSupervisorEnvironment(): void {
  if (process.env.FASTGATE_OFFICIAL !== "1") throw new Error("FASTGATE_SUPERVISOR_OFFICIAL_ONLY");
  if (process.env.DATABASE_URL?.trim()) throw new Error("FASTGATE_SUPERVISOR_REMOTE_DATABASE_FORBIDDEN");
}

function exactUrl(name: string, expected: string): string {
  const value = requiredEnv(name);
  if (value !== expected) throw new Error(`${name}_FORBIDDEN`);
  return value;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function requiredHex(name: string, length: number): string {
  const value = requiredEnv(name);
  if (!new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value)) throw new Error(`${name}_INVALID`);
  return value;
}

function requiredDigest(name: string): string {
  const value = requiredEnv(name);
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error(`${name}_INVALID`);
  return value;
}

function fileSha(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

void main().catch((error: unknown) => {
  process.stderr.write(`FASTGATE CONTAINER FAILED:${error instanceof Error ? error.message : "UNKNOWN"}\n`);
  process.exitCode = 2;
});
