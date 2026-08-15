import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildScopedCleanupPlan,
  isAcceptedDockerIsolation,
  inspectFastGateRuntime,
} from "@/evals/fastgate/official/runtime";

describe("official FastGate infrastructure contract", () => {
  const root = process.cwd();

  it("declares isolated read-only services without host or Docker socket mounts", () => {
    const compose = readFileSync(join(root, "infra/fastgate/compose.yml"), "utf8");
    expect(compose).toContain("internal: true");
    expect(compose).toContain("read_only: true");
    expect(compose.match(/<<:\s*\*fastgate-security/gu)?.length).toBe(5);
    expect(compose).toContain("no-new-privileges:true");
    expect(compose).toContain("cap_drop:");
    expect(compose).toContain("- ALL");
    expect(compose).toContain("/tmp:size=128m,mode=1777");
    expect(compose).not.toContain("/tmp:size=128m,mode=1770");
    expect(compose).not.toMatch(/docker\.sock|\/Users\/|\$\{HOME\}|~\//u);
    expect(compose).not.toMatch(/ports:\s*\n\s*-\s*["']?0\.0\.0\.0/gu);
    const policy = JSON.parse(readFileSync(join(root, "infra/fastgate/network-policy.json"), "utf8")) as {
      defaultExternalEgress?: string;
      hostPublishing?: string;
      forbiddenMounts?: string[];
    };
    expect(policy.defaultExternalEgress).toBe("DENY");
    expect(policy.hostPublishing).toBe("NONE");
    expect(policy.forbiddenMounts).toContain("/var/run/docker.sock");
    expect(compose).toContain("fastgate-proxy-artifacts:/run/fastgate-artifacts");
    expect(compose).toContain("fastgate-witness-artifacts:/run/fastgate-artifacts");
    expect(compose).toContain("fastgate-proxy-artifacts:/run/fastgate-proxy-artifacts:ro");
    expect(compose).toContain("fastgate-witness-artifacts:/run/fastgate-witness-artifacts:ro");
    expect(compose).not.toContain("fastgate-runtime");
    for (const segment of [
      "fastgate-supervisor-proxy",
      "fastgate-supervisor-witness",
      "fastgate-proxy-application",
      "fastgate-proxy-witness",
      "fastgate-verification",
    ]) expect(compose).toContain(`${segment}:`);
  });

  it("uses distinct app, proxy, witness, supervisor, and verifier images", () => {
    const compose = readFileSync(join(root, "infra/fastgate/compose.yml"), "utf8");
    for (const service of ["application:", "http-proxy:", "connector-witness:", "supervisor:", "offline-verifier:"]) {
      expect(compose).toContain(service);
    }
    const requiredMountpoints: Record<string, readonly string[]> = {
      "Dockerfile.application": ["/run/fastgate-public", "/run/fastgate-database"],
      "Dockerfile.proxy": ["/run/fastgate-artifacts", "/run/fastgate-control"],
      "Dockerfile.witness": ["/run/fastgate-public", "/run/fastgate-private", "/run/fastgate-artifacts", "/run/fastgate-control", "/run/fastgate-witness-database"],
      "Dockerfile.supervisor": ["/run/fastgate-public", "/run/fastgate-private", "/run/fastgate-artifacts", "/run/fastgate-control", "/run/fastgate-database"],
      "Dockerfile.verifier": ["/run/fastgate-artifacts"],
    };
    for (const dockerfile of Object.keys(requiredMountpoints)) {
      const contents = readFileSync(join(root, "infra/fastgate", dockerfile), "utf8");
      expect(contents).toMatch(/^FROM\s+[^\s]+@sha256:[a-f0-9]{64}/mu);
      expect(contents).toContain("allowBuilds");
      expect(contents).toContain('"esbuild":true');
      expect(contents).toContain('"unrs-resolver":false');
      expect(contents).toContain("install -d -o 1000 -g 1000");
      for (const mountpoint of requiredMountpoints[dockerfile] ?? []) expect(contents).toContain(mountpoint);
    }
  });

  it("exposes one official CLI, activates witnessed execution, and never passes witness private keys to the app", () => {
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.["fastgate:doctor"]).toContain("fastgate-doctor.ts");
    expect(packageJson.scripts?.["fastgate:official"]).toContain("fastgate-official.ts");
    expect(packageJson.scripts?.["fastgate:verify"]).toContain("fastgate-verify.ts");
    expect(packageJson.scripts?.["fastgate:cleanup"]).toContain("fastgate-cleanup.ts");
    expect(packageJson.scripts?.["eval:agent:fastgate"]).toBe("pnpm fastgate:official");

    const compose = readFileSync(join(root, "infra/fastgate/compose.yml"), "utf8");
    expect(compose).not.toMatch(/PRIVATE_KEY|SIGNING_SEED|ROOT_KEY/iu);
    expect(compose.match(/DEMO_PASSWORD_HASH:/gu)?.length).toBe(2);
    expect(compose.match(/MTR_AGENT_UNIVERSAL_CHAT_ENABLED:/gu)?.length).toBe(2);
    expect(compose.match(/FASTGATE_FIXTURE_RUN_ID:/gu)?.length).toBe(2);
    expect(compose.slice(compose.indexOf("  application:"), compose.indexOf("  http-proxy:")))
      .toContain("FASTGATE_FIXTURE_RUN_ID:");
    expect(compose.slice(compose.indexOf("  connector-witness:"), compose.indexOf("  supervisor:")))
      .toContain("FASTGATE_FIXTURE_RUN_ID:");
    const applicationService = compose.slice(compose.indexOf("  application:"), compose.indexOf("  http-proxy:"));
    expect(applicationService).toContain("FASTGATE_APPLICATION_CONTROL_TOKEN:");
    expect(applicationService).not.toContain("FASTGATE_WITNESS_CONTROL_TOKEN:");
    expect(applicationService).not.toContain("FASTGATE_CONTROL_TOKEN:");
    const witnessService = compose.slice(compose.indexOf("  connector-witness:"), compose.indexOf("  supervisor:"));
    expect(witnessService).toContain("FASTGATE_WITNESS_IMAGE_DIGEST:");
    expect(witnessService).not.toContain("FASTGATE_APPLICATION_CONTROL_TOKEN:");
    const supervisor = readFileSync(join(root, "scripts/fastgate-container-supervisor.ts"), "utf8");
    expect(supervisor).not.toContain("WITNESSED_APPLICATION_CONNECTOR_ADAPTER_NOT_ACTIVE");
    expect(supervisor).toContain("eval-agent-fastgate.ts");
    expect(supervisor).toContain("verifySignedTranscript");
    expect(supervisor).toContain("verifyConnectorWitnessEvent");
    expect(supervisor).toContain("issueComponentCertificate");
    expect(supervisor).toContain("verifyIssuedComponentCertificate");
    expect(supervisor).toContain("issued-connector-witness-certificate.json");
    expect(supervisor).toContain("attestationRootKeyId:");
    expect(supervisor).toContain("attestationRootPublicKeyPem:");
    const applicationStart = readFileSync(join(root, "scripts/fastgate-application-start.ts"), "utf8");
    expect(applicationStart).toContain('"/app/server.js"');
    expect(applicationStart).toContain("uid: 1000");
    expect(applicationStart).toContain("sanitizedApplicationEnvironment");
    expect(applicationStart).not.toContain('spawn("pnpm"');
    const applicationDockerfile = readFileSync(join(root, "infra/fastgate/Dockerfile.application"), "utf8");
    expect(applicationDockerfile).toContain("/app/.next/standalone");
    expect(applicationDockerfile).toContain("/opt/fastgate-control/application-start.mjs");
    expect(applicationDockerfile).toContain(
      'CMD ["node", "--conditions=react-server", "/opt/fastgate-control/application-start.mjs"]',
    );
    expect(applicationDockerfile).not.toContain("COPY --from=build --chown=1000:1000 /app ./");
    const evaluator = readFileSync(join(root, "scripts/eval-agent-fastgate.ts"), "utf8");
    expect(evaluator).not.toContain('resolve("test-results/mtr-agent-fastgate/browser-failures")');
    expect(evaluator).toContain("privilegedActionExecuted:");
    expect(evaluator).toContain("productionTouched:");
    expect(evaluator).toContain("FASTGATE_WITNESS_CONTROL_TOKEN");
    const proxy = readFileSync(join(root, "scripts/fastgate-http-proxy.ts"), "utf8");
    expect(proxy).toContain('forwardedHeaders.set("x-forwarded-host"');
    expect(proxy).toContain('forwardedHeaders.set("x-forwarded-proto"');
    expect(proxy).toContain('"content-encoding"');
    expect(proxy).toContain('response.setHeader("content-length"');
    expect(proxy).toContain("handleWitnessGateway");
    expect(proxy).toContain("activeAgentRequests");
    expect(proxy).toContain("sessionSubjects");
    expect(proxy).not.toContain('stringHeader(request, "x-fastgate-subject-hash") ??');
    expect(applicationService).not.toContain("fastgate-application-witness");
    expect(applicationService).toContain("FASTGATE_WITNESS_URL: http://http-proxy:4310/__fastgate/witness");
  });

  it("binds witness proofs to an independently selected source corpus before capability execution", () => {
    const witness = readFileSync(join(root, "scripts/fastgate-connector-witness.ts"), "utf8");
    expect(witness).toContain("selectIndependentSourceEvidence");
    expect(witness.indexOf("selectIndependentSourceEvidence")).toBeLessThan(witness.indexOf("registry.execute"));
    expect(witness).not.toContain("collectSourceRows(input.output)");
    expect(witness).not.toContain("createObservedConnectorWitness");
    expect(witness).toContain("verifyIssuedComponentCertificate");
    expect(witness).toContain("x-fastgate-witness-gateway-token");
    expect(witness).toContain("x-fastgate-http-template-id");
    expect(witness).toContain("x-fastgate-http-request-hash");
  });

  it("reports absent runtimes without installing and scopes cleanup by project label", async () => {
    const doctor = await inspectFastGateRuntime({
      commandAvailable: async () => false,
      platform: "darwin",
      arch: "arm64",
    });
    expect(doctor).toMatchObject({ ready: false, selectedRuntime: null });
    expect(doctor.blockers).toContain("DISPOSABLE_VM_OR_CONTAINER_UNAVAILABLE");

    const plan = buildScopedCleanupPlan({ runtime: "docker", projectName: "mtr-fastgate-official-run-1" });
    expect(plan.command.join(" ")).toContain("mtr-fastgate-official-run-1");
    expect(plan.command.join(" ")).not.toMatch(/system\s+prune|volume\s+prune|rm\s+-rf/iu);
  });

  it("accepts only a healthy user-owned Colima Docker context as isolated VM runtime", () => {
    expect(isAcceptedDockerIsolation({
      context: "colima",
      endpoint: "unix:///Users/demo/.colima/default/docker.sock",
      homeDirectory: "/Users/demo",
      colimaStatusOk: true,
      securityOptions: '["name=apparmor","name=seccomp,profile=builtin"]',
    })).toBe(true);
    expect(isAcceptedDockerIsolation({
      context: "colima",
      endpoint: "unix:///var/run/docker.sock",
      homeDirectory: "/Users/demo",
      colimaStatusOk: true,
      securityOptions: "[]",
    })).toBe(false);
    expect(isAcceptedDockerIsolation({
      context: "colima",
      endpoint: "unix:///Users/demo/.colima/default/docker.sock",
      homeDirectory: "/Users/demo",
      colimaStatusOk: false,
      securityOptions: "[]",
    })).toBe(false);
  });

  it("runs exactly three isolated supervisor projects, copies evidence, verifies cleanup, and uses a networkless verifier", () => {
    const runner = readFileSync(join(root, "scripts/fastgate-official.ts"), "utf8");
    const verifier = readFileSync(join(root, "scripts/fastgate-container-verifier.ts"), "utf8");
    const verifierDockerfile = readFileSync(join(root, "infra/fastgate/Dockerfile.verifier"), "utf8");
    const publicTrustAnchor = readFileSync(join(root, "infra/fastgate/trust/official-host-root.pem"), "utf8");
    expect(runner).toContain("const REQUIRED_RUNS = 3");
    expect(runner).toContain("ordinal <= REQUIRED_RUNS");
    expect(runner).toContain("const runStamp = stamp.toLowerCase()");
    expect(runner).toContain('"--abort-on-container-exit", "--exit-code-from", "supervisor", "supervisor"');
    expect(runner).toContain("copyRunArtifacts(projectName, runDir, environment)");
    expect(runner).toContain("cleanupComposeProject(projectName, environment)");
    expect(runner).toContain("assertProjectResourcesRemoved(projectName)");
    expect(runner).toContain('"--network", "none", "--read-only", "--cap-drop", "ALL"');
    expect(runner).toContain('"--tmpfs", "/tmp:rw,noexec,nosuid,size=64m,mode=1777"');
    expect(runner).toContain("runIndependentReview");
    expect(runner).toContain("buildArtifactCommitments");
    expect(runner).toContain('["archive", "--format=tar"');
    expect(runner).toContain("host-root-certificate.json");
    expect(runner).toContain("host-attestation.json");
    expect(runner).toContain("runtime-container-attestation.json");
    expect(runner).toContain("application-image-isolation-attestation.json");
    expect(runner).toContain("attestApplicationImageIsolation");
    expect(runner).toContain("independent-review-input.json");
    expect(runner).toContain("independent-review-host-attestation.json");
    expect(runner).toContain("fastgate-independent-review-witness.ts");
    expect(runner).toContain("verifyIndependentReviewWitnessEnvelope");
    expect(runner).toContain("independent-review-codex.jsonl");
    expect(runner).toContain("independent-review-witness.json");
    expect(runner).toContain("official-host-root.key");
    expect(runner).toContain("createPrivateKey");
    expect(runner).not.toContain('generateKeyPairSync("ed25519")');
    expect(verifier).toContain("infra/fastgate/trust/official-host-root.pem");
    expect(verifier).toContain("INDEPENDENT_REVIEW_HOST_ATTESTATION_INVALID");
    expect(verifier).toContain("verifyIndependentReviewWitnessEnvelope");
    expect(verifier).toContain("verifyConnectorHttpBindings");
    expect(verifier).toContain("APPLICATION_IMAGE_ISOLATION_ATTESTATION_INVALID");
    expect(verifier).toContain("INDEPENDENT_REVIEW_INPUT_COMMITMENT_INVALID");
    expect(verifierDockerfile).toContain("infra/fastgate/trust/official-host-root.pem");
    expect(() => createPublicKey(publicTrustAnchor)).not.toThrow();
    expect(runner).not.toMatch(/system\s+prune|volume\s+prune|docker\.sock/iu);
  });

  it("recomputes the post-run target state through the isolated application control boundary", () => {
    const compose = readFileSync(join(root, "infra/fastgate/compose.yml"), "utf8");
    const application = readFileSync(join(root, "scripts/fastgate-application-start.ts"), "utf8");
    const proxy = readFileSync(join(root, "scripts/fastgate-http-proxy.ts"), "utf8");
    const supervisor = readFileSync(join(root, "scripts/fastgate-container-supervisor.ts"), "utf8");
    expect(application).toContain("buildLocalFastGateOracle");
    expect(application).toContain("/__fastgate/control/target-state");
    expect(proxy).toContain("/__fastgate/control/target-state");
    expect(supervisor).toContain("targetStateChecksum");
    expect(supervisor).toContain("TARGET_STATE_CHECKSUM_MISMATCH");
    expect(supervisor).toContain("attestFastGateDatabaseMutations");
    expect(supervisor).toContain("databaseMutationVerified");
    expect(application).toContain("databaseStateBefore");
    expect(application).toContain("actionSafetyAfter");
    expect(application).toContain("FASTGATE_POST_RUN_STATE_PATH");
    expect(application).toContain("postRunStateSha256");
    expect(supervisor).toContain("FASTGATE_POST_RUN_STATE_PATH");
    expect(supervisor).toContain("POST_RUN_STATE_ARTIFACT_HASH_MISMATCH");
    expect(supervisor).toContain("readPostRunStateArtifact");
    expect(compose).toContain("FASTGATE_POST_RUN_STATE_PATH: /run/fastgate-database/post-run-state.json");
  });

  it("keeps fifty authenticated sessions active while measuring a bounded protected workload", () => {
    const supervisor = readFileSync(join(root, "scripts/fastgate-container-supervisor.ts"), "utf8");
    expect(supervisor).toContain("const LOAD_SESSION_COUNT = 50");
    expect(supervisor).toContain("const LOAD_REQUEST_CONCURRENCY = 10");
    expect(supervisor).toContain("const authenticatedSessions = await mapWithConcurrency");
    expect(supervisor).toContain("authenticationSetupP95Ms:");
    expect(supervisor).toContain("queueWaitP95Ms:");
    expect(supervisor.indexOf("const authenticatedSessions = await mapWithConcurrency"))
      .toBeLessThan(supervisor.indexOf("const workloadStartedAt"));
    expect(supervisor).toContain("limitMs: 5_000");
    expect(supervisor).not.toContain("limitMs: 7_000");
  });
});
