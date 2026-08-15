import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign as signBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { homedir, tmpdir } from "node:os";

import { buildFastGateDoctorReport, writeDoctorReport } from "@/evals/fastgate/official/doctor";
import {
  canonicalJson,
  verifyIssuedComponentCertificate,
  type AttestationCertificate,
  type AttestationEnvelope,
  type IssuedComponentCertificatePayload,
} from "@/evals/fastgate/official/attestation";
import type {
  OfficialFastGateAggregate,
  OfficialFastGateRunEvidence,
} from "@/evals/fastgate/official/verifier";
import {
  verifyIndependentReviewWitnessEnvelope,
  type IndependentReviewWitnessEnvelope,
} from "@/evals/fastgate/official/reviewer-witness";

const COMPOSE_FILE = "infra/fastgate/compose.yml";
const REQUIRED_RUNS = 3;
const COMMAND_TIMEOUT_MS = 30 * 60_000;

interface GateSecurity {
  readonly requestedSessions: number;
  readonly passedSessions: number;
  readonly leaks: number;
  readonly violations: number;
}

interface GateLoad {
  readonly requestedSessions: number;
  readonly authenticatedSessions: number;
  readonly uniqueAuthenticatedSessions: number;
  readonly completedSessions: number;
  readonly errors: number;
  readonly p95Ms: number;
  readonly serviceP95Ms: number;
  readonly authenticationSetupP95Ms: number;
  readonly queueWaitP95Ms: number;
  readonly maxInFlightRequests: number;
  readonly limitMs: number;
}

interface ArtifactFileCommitment {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface IndependentReviewRecord {
  readonly schemaVersion: "fastgate-independent-review-v1";
  readonly baseSha: string;
  readonly finalSha: string;
  readonly sourceTreeSha256: string;
  readonly imageDigestsSha256: string;
  readonly runArtifactCommitmentSha256: string;
  readonly inputCommitmentSha256: string;
  readonly reviewerToolIdentity: string;
  readonly reviewerSessionIdHash: string;
  readonly reviewerNonceSha256: string;
  readonly reviewerWitnessKeyId: string;
  readonly reviewerWitnessScriptSha256: string;
  readonly reviewerTranscriptSha256: string;
  readonly reviewerExecutableSha256: string;
  readonly readOnlyAttested: boolean;
  readonly exitStatus: number;
  readonly outputSha256: string;
  readonly findings: Readonly<{ P0: number; P1: number; P2: number; P3: number }>;
  readonly verdict: "PASS" | "FAIL";
}

interface ImageDigests {
  readonly application: string;
  readonly witness: string;
  readonly proxy: string;
  readonly supervisor: string;
  readonly verifier: string;
}

interface HostAttestor {
  readonly certificate: Readonly<{
    schemaVersion: "mtr-fastgate-host-root-v1";
    keyId: string;
    publicKeyPem: string;
    issuedAt: string;
  }>;
  sign(payload: unknown): string;
}

let activeProject: string | null = null;

async function main(): Promise<void> {
  parseRuns(process.argv.slice(2));
  assertCleanTrackedTree();
  const doctor = await buildFastGateDoctorReport({ probeContainer: true });
  if (!doctor.ready || doctor.runtime.selected !== "docker") {
    throw new Error(`BLOCKED_BY_ENVIRONMENT:${doctor.blockers.join(",") || "DOCKER_VM_REQUIRED"}`);
  }

  const finalSha = git("rev-parse", "HEAD");
  const shortSha = finalSha.slice(0, 12);
  const baseSha = git("merge-base", "HEAD", "origin/main");
  const sourceTreeSha256 = trackedTreeHash();
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const runStamp = stamp.toLowerCase();
  const artifactDir = resolve("test-results/mtr-agent-fastgate", `aggregate-${stamp}-${shortSha}`);
  mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
  writeDoctorReport(doctor, join(artifactDir, "doctor.json"));

  const signalHandler = () => {
    if (activeProject) cleanupComposeProject(activeProject);
    process.exit(130);
  };
  process.once("SIGINT", signalHandler);
  process.once("SIGTERM", signalHandler);

  const buildProject = `mtr-fastgate-official-build-${shortSha}`;
  const buildEnvironment = createRunEnvironment({
    finalSha,
    sourceTreeSha256,
    projectName: buildProject,
    runId: `build-${shortSha}`,
    imageDigests: placeholderDigests(),
  });
  const detachedBuildContext = createDetachedBuildContext(finalSha);
  try {
    run("docker", composeArgs(buildProject, "build", "--pull=false"), {
      cwd: detachedBuildContext,
      env: buildEnvironment,
      timeout: 45 * 60_000,
      stdio: "inherit",
    });
  } finally {
    removeDetachedBuildContext(detachedBuildContext);
  }
  const imageDigests = inspectImageDigests(finalSha);
  const hostAttestor = createHostAttestor();
  writeJson(join(artifactDir, "host-root-certificate.json"), hostAttestor.certificate);
  const buildAttestation = Object.freeze({
    schemaVersion: "mtr-agent-fastgate-build-attestation-v1",
    finalSha,
    baseSha,
    sourceTreeSha256,
    builtAt: new Date().toISOString(),
    imageDigests,
    buildContext: "GIT_ARCHIVE_EXACT_SHA",
  });
  writeJson(join(artifactDir, "build-attestation.json"), buildAttestation);
  writeJson(
    join(artifactDir, "application-image-isolation-attestation.json"),
    attestApplicationImageIsolation(finalSha, imageDigests.application),
  );

  const evidences: OfficialFastGateRunEvidence[] = [];
  const securityRuns: GateSecurity[] = [];
  const loadRuns: GateLoad[] = [];
  const runIndex: Array<Readonly<{ runId: string; projectName: string; seedCommitmentSha256: string; artifactPath: string }>> = [];

  for (let ordinal = 1; ordinal <= REQUIRED_RUNS; ordinal += 1) {
    assertCleanTrackedTree();
    if (git("rev-parse", "HEAD") !== finalSha || trackedTreeHash() !== sourceTreeSha256) {
      throw new Error("SOURCE_IDENTITY_CHANGED_DURING_OFFICIAL_RUNS");
    }
    const runId = `official-${shortSha}-${runStamp}-${ordinal}`;
    const projectName = `mtr-fastgate-official-${shortSha}-${ordinal}-${randomBytes(4).toString("hex")}`;
    const runDir = join(artifactDir, `run-${ordinal}`);
    mkdirSync(runDir, { recursive: true, mode: 0o700 });
    const environment = createRunEnvironment({ finalSha, sourceTreeSha256, projectName, runId, imageDigests });
    activeProject = projectName;
    let runError: unknown = null;
    try {
      run("docker", composeArgs(projectName, "up", "--abort-on-container-exit", "--exit-code-from", "supervisor", "supervisor"), {
        env: environment,
        timeout: COMMAND_TIMEOUT_MS,
        stdio: "inherit",
      });
    } catch (error) {
      runError = error;
    } finally {
      writeJson(join(runDir, "runtime-container-attestation.json"), captureRuntimeContainerAttestation(projectName, imageDigests, environment));
      copyRunArtifacts(projectName, runDir, environment);
      cleanupComposeProject(projectName, environment);
      assertProjectResourcesRemoved(projectName);
      activeProject = null;
    }
    if (runError) throw runError;

    const partialPath = join(runDir, "run-evidence.partial.json");
    const partial = readJson<OfficialFastGateRunEvidence>(partialPath);
    const hostAttestation = createHostRunAttestation({
      runDir,
      evidence: partial,
      imageDigests,
      hostAttestor,
    });
    writeJson(join(runDir, "host-attestation.json"), hostAttestation);
    if (!verifyHostWitnessChain(runDir, imageDigests.witness)) {
      throw new Error(`HOST_CONNECTOR_WITNESS_CHAIN_INVALID:${runId}`);
    }
    const evidence: OfficialFastGateRunEvidence = Object.freeze({
      ...partial,
      independentConnectorWitnessVerified: true,
      runtimeAttestationVerified: true,
      cleanupVerified: true,
    });
    writeJson(join(runDir, "run-evidence.json"), evidence);
    const security = readJson<GateSecurity>(join(runDir, "security-gate.json"));
    const load = readJson<GateLoad>(join(runDir, "load-gate.json"));
    assertRunGate(evidence, security, load);
    evidences.push(evidence);
    securityRuns.push(security);
    loadRuns.push(load);
    runIndex.push(Object.freeze({
      runId,
      projectName,
      seedCommitmentSha256: sha256(evidence.seed),
      artifactPath: `run-${ordinal}`,
    }));
  }

  writeJson(join(artifactDir, "three-run-index.json"), {
    schemaVersion: "mtr-agent-fastgate-three-run-index-v1",
    finalSha,
    runs: runIndex,
  });

  const review = runIndependentReview({ artifactDir, baseSha, finalSha, imageDigests, sourceTreeSha256, hostAttestor });
  if (review.verdict !== "PASS" || review.findings.P0 + review.findings.P1 + review.findings.P2 > 0) {
    throw new Error("INDEPENDENT_REVIEW_FOUND_RELEASE_BLOCKERS");
  }

  const artifactFiles = buildArtifactCommitments(artifactDir, ["aggregate.json", "artifact-index.json", "report.md", "verification.json"]);
  writeJson(join(artifactDir, "artifact-index.json"), {
    schemaVersion: "mtr-agent-fastgate-artifact-index-v1",
    files: artifactFiles,
  });

  const aggregate: OfficialFastGateAggregate = {
    schemaVersion: "mtr-agent-fastgate-official-aggregate-v1",
    generatedAt: new Date().toISOString(),
    runs: evidences,
    security: aggregateSecurity(securityRuns),
    load: aggregateLoad(loadRuns),
    securityRuns,
    loadRuns,
    artifactFiles,
    independentReview: {
      valid: review.verdict === "PASS",
      reviewerRole: "READ_ONLY_REVIEWER",
      artifactSha256: review.outputSha256,
      inputCommitmentSha256: review.inputCommitmentSha256,
      finalSha: review.finalSha,
    },
  };
  writeJson(join(artifactDir, "aggregate.json"), aggregate);
  writeFileSync(join(artifactDir, "report.md"), buildReport(aggregate, imageDigests), { mode: 0o600 });

  runOfflineVerifier({ artifactDir, finalSha, verifierDigest: imageDigests.verifier });
  const verification = readJson<{ valid: boolean; verdict: string; errors: readonly string[] }>(join(artifactDir, "verification.json"));
  if (!verification.valid || verification.verdict !== "PASS") {
    throw new Error(`OFFLINE_VERIFICATION_FAILED:${verification.errors.join(",")}`);
  }
  assertCleanTrackedTree();
  process.stdout.write(`FASTGATE OFFICIAL: PASS\nArtifacts: ${artifactDir}\n`);
}

function verifyHostWitnessChain(runDir: string, witnessImageDigest: string): boolean {
  const transcript = readJson<{
    runId: string;
    certificate: AttestationCertificate;
    supervisorCertificate: AttestationCertificate;
    issuedCertificate: AttestationEnvelope<IssuedComponentCertificatePayload>;
  }>(join(runDir, "raw-witness", "connector-transcript.final.json"));
  return transcript.certificate.runId === transcript.runId
    && verifyIssuedComponentCertificate(
      transcript.issuedCertificate,
      transcript.supervisorCertificate,
      transcript.certificate,
      { role: "CONNECTOR_WITNESS", imageDigest: witnessImageDigest },
    );
}

function createRunEnvironment(input: Readonly<{
  finalSha: string;
  sourceTreeSha256: string;
  projectName: string;
  runId: string;
  imageDigests: ImageDigests;
}>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FASTGATE_IMAGE_TAG: input.finalSha,
    FASTGATE_PROJECT_NAME: input.projectName,
    FASTGATE_RUN_ID: input.runId,
    FASTGATE_RUN_NONCE: randomBytes(32).toString("hex"),
    FASTGATE_SEED: randomBytes(32).toString("hex"),
    FASTGATE_APPLICATION_CONTROL_TOKEN: randomBytes(32).toString("hex"),
    FASTGATE_PROXY_CONTROL_TOKEN: randomBytes(32).toString("hex"),
    FASTGATE_WITNESS_CONTROL_TOKEN: randomBytes(32).toString("hex"),
    FASTGATE_WITNESS_GATEWAY_TOKEN: randomBytes(32).toString("hex"),
    FASTGATE_SOURCE_TREE_SHA256: input.sourceTreeSha256,
    FASTGATE_APPLICATION_IMAGE_DIGEST: input.imageDigests.application,
    FASTGATE_WITNESS_IMAGE_DIGEST: input.imageDigests.witness,
    FASTGATE_PROXY_IMAGE_DIGEST: input.imageDigests.proxy,
    FASTGATE_SUPERVISOR_IMAGE_DIGEST: input.imageDigests.supervisor,
    FASTGATE_VERIFIER_IMAGE_DIGEST: input.imageDigests.verifier,
  };
}

function copyRunArtifacts(projectName: string, runDir: string, environment: NodeJS.ProcessEnv): void {
  const log = spawnSync("docker", composeArgs(projectName, "logs", "--no-color"), {
    env: environment,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  writeFileSync(join(runDir, "compose.log"), `${log.stdout ?? ""}${log.stderr ?? ""}`, { mode: 0o600 });
  const containerId = capture("docker", composeArgs(projectName, "ps", "-aq", "supervisor"), environment);
  if (!containerId) throw new Error(`SUPERVISOR_CONTAINER_NOT_FOUND:${projectName}`);
  run("docker", ["cp", `${containerId}:/run/fastgate-artifacts/.`, `${runDir}/`], { env: environment });
  mkdirSync(join(runDir, "raw-proxy"), { recursive: true, mode: 0o700 });
  mkdirSync(join(runDir, "raw-witness"), { recursive: true, mode: 0o700 });
  run("docker", ["cp", `${containerId}:/run/fastgate-proxy-artifacts/.`, `${join(runDir, "raw-proxy")}/`], { env: environment });
  run("docker", ["cp", `${containerId}:/run/fastgate-witness-artifacts/.`, `${join(runDir, "raw-witness")}/`], { env: environment });
}

function captureRuntimeContainerAttestation(projectName: string, expected: ImageDigests, environment: NodeJS.ProcessEnv): unknown {
  const services = {
    application: expected.application,
    "connector-witness": expected.witness,
    "http-proxy": expected.proxy,
    supervisor: expected.supervisor,
  } as const;
  const observed: Record<string, string> = {};
  for (const [service, digest] of Object.entries(services)) {
    const containerId = capture("docker", composeArgs(projectName, "ps", "-aq", service), environment);
    if (!containerId) throw new Error(`RUNTIME_CONTAINER_NOT_FOUND:${projectName}:${service}`);
    const actual = capture("docker", ["inspect", containerId, "--format", "{{.Image}}"], environment);
    if (actual !== digest) throw new Error(`RUNTIME_IMAGE_DIGEST_MISMATCH:${service}`);
    observed[service] = actual;
  }
  return Object.freeze({
    schemaVersion: "mtr-fastgate-runtime-container-attestation-v1",
    projectName,
    observed,
    verified: true,
  });
}

function attestApplicationImageIsolation(finalSha: string, expectedDigest: string): unknown {
  const image = `mtr-fastgate-application:${finalSha}`;
  if (inspectDigest(image) !== expectedDigest) throw new Error("APPLICATION_IMAGE_DIGEST_CHANGED");
  run("docker", [
    "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true", "--user", "1000:1000", "--entrypoint", "/bin/sh",
    image, "-c",
    "test -r /app/server.js"
      + " && test -r /opt/fastgate-control/application-start.mjs"
      + " && test ! -e /app/scripts/eval-agent-fastgate.ts"
      + " && test ! -e /app/evals/mtr-agent-fastgate-v1.json"
      + " && test ! -e /app/src/evals/fastgate/scoring.ts",
  ]);
  const config = JSON.parse(capture("docker", ["image", "inspect", image, "--format", "{{json .Config}}"])) as {
    Cmd?: readonly string[];
    User?: string;
  };
  if (canonicalJson(config.Cmd) !== canonicalJson([
    "node",
    "--conditions=react-server",
    "/opt/fastgate-control/application-start.mjs",
  ])
    || config.User !== "1000:1000") throw new Error("APPLICATION_CONTROL_WRAPPER_CONFIGURATION_INVALID");
  const bootstrapSource = readFileSync(resolve("scripts/fastgate-application-start.ts"), "utf8");
  const removalIndex = bootstrapSource.indexOf("removeLoadedBootstrapEntrypoint();");
  const applicationSpawnIndex = bootstrapSource.indexOf("const child = spawn(");
  if (removalIndex < 0 || applicationSpawnIndex < 0 || removalIndex >= applicationSpawnIndex) {
    throw new Error("APPLICATION_CONTROL_WRAPPER_SELF_REMOVAL_INVALID");
  }
  return Object.freeze({
    schemaVersion: "mtr-fastgate-application-image-isolation-v1",
    imageDigest: expectedDigest,
    applicationProcessUid: 1000,
    evaluatorReadableByApplication: false,
    manifestReadableByApplication: false,
    scoringReadableByApplication: false,
    controlWrapperReadableByApplication: false,
    controlWrapperRemovedBeforeApplicationSpawn: true,
    verified: true,
  });
}

function createHostAttestor(): HostAttestor {
  const privateKeyPath = resolve(process.env.FASTGATE_HOST_ATTESTOR_PRIVATE_KEY?.trim()
    || join(homedir(), ".config/mtr-fastgate/official-host-root.key"));
  const repositoryRoot = `${resolve(process.cwd())}${sep}`;
  if (privateKeyPath.startsWith(repositoryRoot)) throw new Error("FASTGATE_HOST_PRIVATE_KEY_MUST_BE_EXTERNAL");
  if (!existsSync(privateKeyPath)) throw new Error("BLOCKED_BY_ENVIRONMENT:FASTGATE_HOST_PRIVATE_KEY_REQUIRED");
  const privateKeyStats = statSync(privateKeyPath);
  if (!privateKeyStats.isFile() || (privateKeyStats.mode & 0o077) !== 0) {
    throw new Error("BLOCKED_BY_ENVIRONMENT:FASTGATE_HOST_PRIVATE_KEY_PERMISSIONS");
  }
  const privateKey = createPrivateKey(readFileSync(privateKeyPath));
  const publicKey = createPublicKey(privateKey);
  const pinnedPublicKeyPem = readFileSync(resolve("infra/fastgate/trust/official-host-root.pem"), "utf8");
  const pinnedPublicKey = createPublicKey(pinnedPublicKeyPem);
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  const pinnedPublicKeyDer = pinnedPublicKey.export({ format: "der", type: "spki" });
  if (!Buffer.from(publicKeyDer).equals(Buffer.from(pinnedPublicKeyDer))) {
    throw new Error("BLOCKED_BY_ENVIRONMENT:FASTGATE_HOST_TRUST_ROOT_MISMATCH");
  }
  const certificate = Object.freeze({
    schemaVersion: "mtr-fastgate-host-root-v1" as const,
    keyId: sha256(pinnedPublicKeyDer),
    publicKeyPem: pinnedPublicKeyPem,
    issuedAt: new Date().toISOString(),
  });
  return Object.freeze({
    certificate,
    sign(payload: unknown): string {
      return signBytes(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64");
    },
  });
}

function createHostRunAttestation(input: Readonly<{
  runDir: string;
  evidence: OfficialFastGateRunEvidence;
  imageDigests: ImageDigests;
  hostAttestor: HostAttestor;
}>): unknown {
  const payload = Object.freeze({
    schemaVersion: "mtr-fastgate-host-run-attestation-v1",
    runId: input.evidence.runId,
    deploymentSha: input.evidence.deploymentSha,
    sourceTreeSha256: input.evidence.sourceTreeSha256,
    rootKeyId: input.hostAttestor.certificate.keyId,
    imageDigests: input.imageDigests,
    runtimeContainerAttestationSha256: fileSha(join(input.runDir, "runtime-container-attestation.json")),
    runIdentitySha256: fileSha(join(input.runDir, "run-identity.json")),
    httpProxyCertificateSha256: fileSha(join(input.runDir, "raw-proxy", "http-proxy-certificate.json")),
    httpTranscriptSha256: fileSha(join(input.runDir, "raw-proxy", "http-transcript.final.json")),
    connectorWitnessCertificateSha256: fileSha(join(input.runDir, "raw-witness", "connector-witness-certificate.json")),
    supervisorCertificateSha256: fileSha(join(input.runDir, "raw-witness", "supervisor-certificate.json")),
    issuedConnectorWitnessCertificateSha256: fileSha(join(input.runDir, "raw-witness", "issued-connector-witness-certificate.json")),
    connectorTranscriptSha256: fileSha(join(input.runDir, "raw-witness", "connector-transcript.final.json")),
    postRunTargetStateSha256: fileSha(join(input.runDir, "post-run-target-state.json")),
  });
  return Object.freeze({
    schemaVersion: "mtr-fastgate-host-run-attestation-envelope-v1",
    payload,
    signatureBase64: input.hostAttestor.sign(payload),
  });
}

function cleanupComposeProject(projectName: string, environment: NodeJS.ProcessEnv = process.env): void {
  spawnSync("docker", composeArgs(projectName, "down", "--volumes", "--remove-orphans"), {
    env: environment,
    stdio: "ignore",
    timeout: 120_000,
  });
}

function assertProjectResourcesRemoved(projectName: string): void {
  const filters = [
    ["ps", "-aq", "--filter", `label=com.docker.compose.project=${projectName}`],
    ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${projectName}`],
    ["network", "ls", "-q", "--filter", `label=com.docker.compose.project=${projectName}`],
  ] as const;
  for (const args of filters) {
    if (capture("docker", [...args])) throw new Error(`SCOPED_CLEANUP_FAILED:${projectName}:${args[0]}`);
  }
}

function assertRunGate(evidence: OfficialFastGateRunEvidence, security: GateSecurity, load: GateLoad): void {
  const booleanEvidence = [
    evidence.diagnosticSignatureVerified,
    evidence.independentConnectorWitnessVerified,
    evidence.signedHttpTranscriptVerified,
    evidence.runtimeAttestationVerified,
    evidence.counterfactualWitnessVerified,
    evidence.sourceBindingVerified,
    evidence.cleanupVerified,
    evidence.databaseMutationVerified,
  ];
  if (evidence.assessmentConfidence !== "HIGH" || evidence.agentMessageCount !== 23 || evidence.passedCaseCount !== 12
    || evidence.acceptanceReadinessScore < 93 || evidence.evaluationCoveragePercent !== 100
    || evidence.appliedCaps.length || evidence.criticalBlockers.length || booleanEvidence.some((value) => !value)) {
    throw new Error(`OFFICIAL_RUN_GATE_FAILED:${evidence.runId}`);
  }
  if (security.requestedSessions !== 10 || security.passedSessions !== 10 || security.leaks !== 0 || security.violations !== 0) {
    throw new Error(`SECURITY_GATE_FAILED:${evidence.runId}`);
  }
  if (load.requestedSessions !== 50 || load.authenticatedSessions !== 50 || load.uniqueAuthenticatedSessions !== 50
    || load.completedSessions !== 50 || load.errors !== 0 || load.maxInFlightRequests > 10
    || load.p95Ms > load.limitMs || load.p95Ms > 5_000) {
    throw new Error(`LOAD_GATE_FAILED:${evidence.runId}`);
  }
}

function runIndependentReview(input: Readonly<{
  artifactDir: string;
  baseSha: string;
  finalSha: string;
  imageDigests: ImageDigests;
  sourceTreeSha256: string;
  hostAttestor: HostAttestor;
}>): IndependentReviewRecord {
  const schemaPath = join(input.artifactDir, "independent-review-output-schema.json");
  const outputPath = join(input.artifactDir, "independent-review-raw.json");
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["findings", "verdict", "summary"],
    properties: {
      findings: {
        type: "object",
        additionalProperties: false,
        required: ["P0", "P1", "P2", "P3"],
        properties: { P0: { type: "integer", minimum: 0 }, P1: { type: "integer", minimum: 0 }, P2: { type: "integer", minimum: 0 }, P3: { type: "integer", minimum: 0 } },
      },
      verdict: { type: "string", enum: ["PASS", "FAIL"] },
      summary: { type: "string" },
    },
  };
  writeJson(schemaPath, schema);
  const imageDigestsSha256 = sha256(canonicalJson(input.imageDigests));
  const preReviewFiles = buildArtifactCommitments(input.artifactDir, [
    "pre-review-artifact-commitment.json",
    "independent-review-input.json",
    "independent-review-raw.json",
    "independent-review-codex.jsonl",
    "independent-review-witness.json",
    "independent-review.md",
    "independent-review.json",
    "independent-review-host-attestation.json",
    "aggregate.json",
    "artifact-index.json",
    "report.md",
    "verification.json",
  ]);
  const runArtifactCommitmentSha256 = sha256(canonicalJson(preReviewFiles));
  writeJson(join(input.artifactDir, "pre-review-artifact-commitment.json"), {
    schemaVersion: "fastgate-pre-review-artifact-commitment-v1",
    files: preReviewFiles,
    commitmentSha256: runArtifactCommitmentSha256,
  });
  const reviewInput = [
    "Perform an independent read-only release-blocking code review. Do not edit files or Git refs.",
    `Repository: ${process.cwd()}`,
    `Base SHA: ${input.baseSha}`,
    `Final SHA: ${input.finalSha}`,
    `Source tree SHA-256: ${input.sourceTreeSha256}`,
    `Image digests SHA-256: ${imageDigestsSha256}`,
    `Run artifact directory: ${input.artifactDir}`,
    `Run artifact commitment SHA-256: ${runArtifactCommitmentSha256}`,
    "Review git diff base..final and FastGate infrastructure for P0-P3 defects only.",
    "Explicitly inspect trust boundaries, private-key exposure, self-attestation, transcript forgery, oracle leakage, network/filesystem isolation, Docker socket/host mounts, RBAC leakage, FG-12 side effects, scoring manipulation, SHA/image mismatch, cleanup scope, secrets/PII artifacts, and false HIGH/PASS.",
    "Return only the requested JSON. PASS requires P0=P1=P2=0.",
  ].join("\n");
  const reviewerNonce = randomBytes(32).toString("hex");
  const reviewInputArtifact = Object.freeze({
    schemaVersion: "fastgate-independent-review-input-v1",
    baseSha: input.baseSha,
    finalSha: input.finalSha,
    sourceTreeSha256: input.sourceTreeSha256,
    imageDigests: input.imageDigests,
    runArtifactCommitmentSha256,
    reviewPrompt: reviewInput,
    reviewerNonceSha256: sha256(reviewerNonce),
  });
  const inputCommitmentSha256 = sha256(canonicalJson(reviewInputArtifact));
  writeJson(join(input.artifactDir, "independent-review-input.json"), reviewInputArtifact);
  const reviewerWitnessScript = resolve("scripts/fastgate-independent-review-witness.ts");
  const reviewerWitnessScriptSha256 = fileSha(reviewerWitnessScript);
  const review = spawnSync(process.execPath, [
    "--import", "tsx", reviewerWitnessScript,
  ], {
    encoding: "utf8",
    timeout: 30 * 60_000,
    maxBuffer: 30 * 1024 * 1024,
    env: reviewerWitnessEnvironment({
      FASTGATE_REVIEW_ARTIFACT_DIR: input.artifactDir,
      FASTGATE_REVIEW_INPUT_PATH: join(input.artifactDir, "independent-review-input.json"),
      FASTGATE_REVIEW_SCHEMA_PATH: schemaPath,
      FASTGATE_REVIEW_FINAL_SHA: input.finalSha,
      FASTGATE_REVIEW_SOURCE_TREE_SHA256: input.sourceTreeSha256,
      FASTGATE_REVIEWER_NONCE: reviewerNonce,
    }),
  });
  const witnessPath = join(input.artifactDir, "independent-review-witness.json");
  const transcriptPath = join(input.artifactDir, "independent-review-codex.jsonl");
  if (review.status !== 0 || !existsSync(outputPath) || !existsSync(witnessPath) || !existsSync(transcriptPath)) {
    throw new Error(`INDEPENDENT_REVIEW_FAILED:${review.status ?? "signal"}:${review.stderr?.trim() || "NO_WITNESS"}`);
  }
  const witness = readJson<IndependentReviewWitnessEnvelope>(witnessPath);
  const outputBytes = readFileSync(outputPath);
  const transcriptBytes = readFileSync(transcriptPath);
  const witnessValid = verifyIndependentReviewWitnessEnvelope(witness, {
    finalSha: input.finalSha,
    sourceTreeSha256: input.sourceTreeSha256,
    witnessScriptSha256: reviewerWitnessScriptSha256,
    inputCommitmentSha256,
    stdoutSha256: sha256(transcriptBytes),
    outputSha256: sha256(outputBytes),
  });
  if (!witnessValid || witness.payload.exitStatus !== 0) throw new Error("INDEPENDENT_REVIEW_WITNESS_INVALID");
  const parsed = readJson<{ findings: IndependentReviewRecord["findings"]; verdict: "PASS" | "FAIL"; summary: string }>(outputPath);
  if (canonicalJson(parsed.findings) !== canonicalJson(witness.payload.findings) || parsed.verdict !== witness.payload.verdict) {
    throw new Error("INDEPENDENT_REVIEW_OUTPUT_WITNESS_MISMATCH");
  }
  const record: IndependentReviewRecord = Object.freeze({
    schemaVersion: "fastgate-independent-review-v1",
    baseSha: input.baseSha,
    finalSha: input.finalSha,
    sourceTreeSha256: input.sourceTreeSha256,
    imageDigestsSha256,
    runArtifactCommitmentSha256,
    inputCommitmentSha256,
    reviewerToolIdentity: witness.payload.codexVersion,
    reviewerSessionIdHash: witness.payload.reviewerSessionIdHash,
    reviewerNonceSha256: sha256(reviewerNonce),
    reviewerWitnessKeyId: witness.certificate.keyId,
    reviewerWitnessScriptSha256,
    reviewerTranscriptSha256: witness.payload.stdoutSha256,
    reviewerExecutableSha256: witness.payload.codexExecutableSha256,
    readOnlyAttested: true,
    exitStatus: witness.payload.exitStatus,
    outputSha256: sha256(outputBytes),
    findings: parsed.findings,
    verdict: parsed.verdict,
  });
  writeJson(join(input.artifactDir, "independent-review.json"), record);
  const attestationPayload = Object.freeze({
    schemaVersion: "mtr-fastgate-host-independent-review-attestation-v1",
    rootKeyId: input.hostAttestor.certificate.keyId,
    baseSha: record.baseSha,
    finalSha: record.finalSha,
    sourceTreeSha256: record.sourceTreeSha256,
    imageDigestsSha256: record.imageDigestsSha256,
    runArtifactCommitmentSha256: record.runArtifactCommitmentSha256,
    inputCommitmentSha256: record.inputCommitmentSha256,
    outputSha256: record.outputSha256,
    reviewerWitnessEnvelopeSha256: fileSha(witnessPath),
    reviewRecordSha256: sha256(canonicalJson(record)),
  });
  writeJson(join(input.artifactDir, "independent-review-host-attestation.json"), {
    schemaVersion: "mtr-fastgate-host-independent-review-attestation-envelope-v1",
    payload: attestationPayload,
    signatureBase64: input.hostAttestor.sign(attestationPayload),
  });
  return record;
}

function runOfflineVerifier(input: Readonly<{ artifactDir: string; finalSha: string; verifierDigest: string }>): void {
  if (inspectDigest(`mtr-fastgate-offline-verifier:${input.finalSha}`) !== input.verifierDigest) {
    throw new Error("OFFLINE_VERIFIER_IMAGE_DIGEST_CHANGED");
  }
  const suffix = randomBytes(5).toString("hex");
  const volume = `mtr-fastgate-official-review-${suffix}`;
  const copier = `mtr-fastgate-official-copy-${suffix}`;
  const verifier = `mtr-fastgate-official-verifier-${suffix}`;
  run("docker", ["volume", "create", "--label", "mtr.fastgate.scope=official-review", volume]);
  try {
    run("docker", ["create", "--name", copier, "--user", "0:0", "--entrypoint", "/bin/sh", "-v", `${volume}:/run/fastgate-artifacts`, `mtr-fastgate-offline-verifier:${input.finalSha}`, "-c", "chown -R 1000:1000 /run/fastgate-artifacts && chmod -R u+rwX,go-rwx /run/fastgate-artifacts"]);
    run("docker", ["cp", `${input.artifactDir}/.`, `${copier}:/run/fastgate-artifacts/`]);
    run("docker", ["start", "-a", copier]);
    run("docker", ["rm", copier]);
    run("docker", [
      "create", "--name", verifier, "--network", "none", "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges", "--user", "1000:1000",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m,mode=1777",
      "-e", "FASTGATE_ARTIFACT_DIR=/run/fastgate-artifacts", "-v", `${volume}:/run/fastgate-artifacts`,
      `mtr-fastgate-offline-verifier:${input.finalSha}`,
    ]);
    run("docker", ["start", "-a", verifier], { stdio: "inherit" });
    run("docker", ["cp", `${verifier}:/run/fastgate-artifacts/verification.json`, join(input.artifactDir, "verification.json")]);
  } finally {
    spawnSync("docker", ["rm", "-f", copier, verifier], { stdio: "ignore" });
    spawnSync("docker", ["volume", "rm", volume], { stdio: "ignore" });
  }
  if (capture("docker", ["ps", "-aq", "--filter", `name=${verifier}`]) || capture("docker", ["volume", "ls", "-q", "--filter", `name=${volume}`])) {
    throw new Error("OFFLINE_VERIFIER_CLEANUP_FAILED");
  }
}

function buildArtifactCommitments(root: string, excludedNames: readonly string[]): ArtifactFileCommitment[] {
  const excluded = new Set(excludedNames);
  return listFiles(root)
    .map((path) => relative(root, path))
    .filter((path) => !excluded.has(path))
    .sort()
    .map((path) => {
      const bytes = readFileSync(join(root, path));
      return Object.freeze({ path, bytes: bytes.length, sha256: sha256(bytes) });
    });
}

function listFiles(root: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) output.push(...listFiles(path));
    else output.push(path);
  }
  return output;
}

function aggregateSecurity(runs: readonly GateSecurity[]): GateSecurity {
  return {
    requestedSessions: Math.min(...runs.map((run) => run.requestedSessions)),
    passedSessions: Math.min(...runs.map((run) => run.passedSessions)),
    leaks: runs.reduce((sum, run) => sum + run.leaks, 0),
    violations: runs.reduce((sum, run) => sum + run.violations, 0),
  };
}

function aggregateLoad(runs: readonly GateLoad[]): GateLoad {
  return {
    requestedSessions: Math.min(...runs.map((run) => run.requestedSessions)),
    authenticatedSessions: Math.min(...runs.map((run) => run.authenticatedSessions)),
    uniqueAuthenticatedSessions: Math.min(...runs.map((run) => run.uniqueAuthenticatedSessions)),
    completedSessions: Math.min(...runs.map((run) => run.completedSessions)),
    errors: runs.reduce((sum, run) => sum + run.errors, 0),
    p95Ms: Math.max(...runs.map((run) => run.p95Ms)),
    serviceP95Ms: Math.max(...runs.map((run) => run.serviceP95Ms)),
    authenticationSetupP95Ms: Math.max(...runs.map((run) => run.authenticationSetupP95Ms)),
    queueWaitP95Ms: Math.max(...runs.map((run) => run.queueWaitP95Ms)),
    maxInFlightRequests: Math.max(...runs.map((run) => run.maxInFlightRequests)),
    limitMs: Math.min(5_000, ...runs.map((run) => run.limitMs)),
  };
}

function buildReport(aggregate: OfficialFastGateAggregate, imageDigests: ImageDigests): string {
  const scores = aggregate.runs.map((run) => run.acceptanceReadinessScore).sort((a, b) => a - b);
  return `# MTR Agent FastGate — official result\n\n` +
    `- Runs: ${aggregate.runs.length}/3\n` +
    `- Cases: ${aggregate.runs.every((run) => run.passedCaseCount === 12) ? "12/12 PASS in every run" : "FAIL"}\n` +
    `- Acceptance readiness min/median/max: ${scores[0]}/${scores[1]}/${scores[2]}\n` +
    `- Confidence: ${aggregate.runs.every((run) => run.assessmentConfidence === "HIGH") ? "HIGH" : "FAIL"}\n` +
    `- Security: ${aggregate.security.passedSessions}/10, leaks ${aggregate.security.leaks}\n` +
    `- Load: ${aggregate.load.completedSessions}/50 over ${aggregate.load.uniqueAuthenticatedSessions} unique active sessions, errors ${aggregate.load.errors}, p95 ${aggregate.load.p95Ms} ms, max in-flight ${aggregate.load.maxInFlightRequests}\n` +
    `- Independent review: ${aggregate.independentReview.valid ? "PASS" : "FAIL"}\n` +
    `- Images: ${sha256(JSON.stringify(imageDigests))}\n` +
    `- Push/PR/Preview/Production: NOT PERFORMED\n`;
}

function inspectImageDigests(sha: string): ImageDigests {
  return {
    application: inspectDigest(`mtr-fastgate-application:${sha}`),
    witness: inspectDigest(`mtr-fastgate-connector-witness:${sha}`),
    proxy: inspectDigest(`mtr-fastgate-http-proxy:${sha}`),
    supervisor: inspectDigest(`mtr-fastgate-supervisor:${sha}`),
    verifier: inspectDigest(`mtr-fastgate-offline-verifier:${sha}`),
  };
}

function inspectDigest(image: string): string {
  const digest = capture("docker", ["image", "inspect", image, "--format", "{{.Id}}"]).trim();
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) throw new Error(`INVALID_IMAGE_DIGEST:${image}`);
  return digest;
}

function createDetachedBuildContext(finalSha: string): string {
  const directory = mkdtempSync(join(tmpdir(), "mtr-fastgate-build-"));
  const archive = join(directory, "source.tar");
  run("git", ["archive", "--format=tar", `--output=${archive}`, finalSha]);
  run("tar", ["-xf", archive, "-C", directory]);
  unlinkSync(archive);
  return directory;
}

function removeDetachedBuildContext(directory: string): void {
  const prefix = join(tmpdir(), "mtr-fastgate-build-");
  if (!directory.startsWith(prefix) || directory === prefix) throw new Error("UNSAFE_DETACHED_BUILD_CLEANUP_TARGET");
  rmSync(directory, { recursive: true, force: true });
}

function placeholderDigests(): ImageDigests {
  const value = `sha256:${"0".repeat(64)}`;
  return { application: value, witness: value, proxy: value, supervisor: value, verifier: value };
}

function composeArgs(projectName: string, ...args: string[]): string[] {
  return ["compose", "--project-name", projectName, "-f", COMPOSE_FILE, ...args];
}

function parseRuns(argv: readonly string[]): number {
  const index = argv.indexOf("--runs");
  const inline = argv.find((argument) => argument.startsWith("--runs="));
  const value = inline?.slice("--runs=".length) ?? (index >= 0 ? argv[index + 1] : String(REQUIRED_RUNS));
  if (Number(value) !== REQUIRED_RUNS) throw new Error("OFFICIAL_FASTGATE_REQUIRES_EXACTLY_THREE_RUNS");
  return REQUIRED_RUNS;
}

function assertCleanTrackedTree(): void {
  const dirty = git("status", "--porcelain", "--untracked-files=all");
  if (dirty) throw new Error(`OFFICIAL_RUN_REQUIRES_CLEAN_TRACKED_TREE:${dirty.split("\n")[0]}`);
}

function trackedTreeHash(): string {
  const files = execFileSync("git", ["ls-files", "-z"], { encoding: "buffer", maxBuffer: 30 * 1024 * 1024 })
    .toString("utf8").split("\0").filter(Boolean).sort();
  const digest = createHash("sha256");
  for (const file of files) digest.update(file).update("\0").update(readFileSync(file)).update("\0");
  return digest.digest("hex");
}

function run(command: string, args: readonly string[], options: Readonly<{
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  stdio?: "inherit" | "ignore";
}> = {}): void {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    timeout: options.timeout ?? 120_000,
    stdio: options.stdio ?? "ignore",
  });
  if (result.status !== 0) throw new Error(`COMMAND_FAILED:${command}:${args.join(" ")}:${result.status ?? "signal"}`);
}

function capture(command: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync(command, [...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 20 * 1024 * 1024 }).trim();
}

function git(...args: string[]): string { return capture("git", args); }
function sha256(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function fileSha(path: string): string { return sha256(readFileSync(path)); }
function readJson<T>(path: string): T { return JSON.parse(readFileSync(path, "utf8")) as T; }
function writeJson(path: string, value: unknown): void { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); }

function reviewerWitnessEnvironment(extra: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const allowed = ["HOME", "PATH", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM", "USER", "LOGNAME", "CODEX_HOME", "SSL_CERT_FILE", "SSL_CERT_DIR"];
  return {
    ...Object.fromEntries(allowed.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]])),
    ...extra,
  } as NodeJS.ProcessEnv;
}

void main().catch((error: unknown) => {
  if (activeProject) cleanupComposeProject(activeProject);
  process.stderr.write(`FASTGATE_OFFICIAL_FAILED:${error instanceof Error ? error.message : "UNKNOWN"}\n`);
  process.exitCode = 2;
});
