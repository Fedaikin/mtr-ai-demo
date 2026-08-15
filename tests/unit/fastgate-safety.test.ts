import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertCredentialsFileSafe,
  assertFastGateRequestAllowed,
  fastGatePreflight,
  FastGateSafetyError,
} from "@/evals/fastgate/safety";

describe("MTR Agent FastGate safety barriers", () => {
  it("allows local mode only on a generated loopback origin", () => {
    expect(fastGatePreflight({}, "a".repeat(40))).toMatchObject({
      mode: "LOCAL",
      origin: "http://127.0.0.1:3187",
      directOracleAllowed: true,
    });
  });

  it("разрешает только точный внутренний proxy в supervised official container", () => {
    expect(fastGatePreflight({
      FASTGATE_CONTAINER_OFFICIAL: "1",
      FASTGATE_OFFICIAL: "1",
      FASTGATE_SUPERVISED: "true",
      FASTGATE_INTERNAL_ORIGIN: "http://http-proxy:4310",
    }, "a".repeat(40))).toMatchObject({
      mode: "LOCAL",
      origin: "http://http-proxy:4310",
      directOracleAllowed: false,
      databaseAttested: true,
    });
    expect(() => fastGatePreflight({
      FASTGATE_CONTAINER_OFFICIAL: "1",
      FASTGATE_OFFICIAL: "1",
      FASTGATE_SUPERVISED: "true",
      FASTGATE_INTERNAL_ORIGIN: "http://application:3000",
    }, "a".repeat(40))).toThrowError(new FastGateSafetyError("OFFICIAL_INTERNAL_ORIGIN_FORBIDDEN"));
  });

  it("blocks Preview before login when release metadata is absent", () => {
    expect(() => fastGatePreflight({
      PLAYWRIGHT_BASE_URL: "https://branch.example.test",
      FASTGATE_ALLOW_PREVIEW: "true",
    }, "a".repeat(40))).toThrowError(new FastGateSafetyError("RELEASE_METADATA_REQUIRED"));
  });

  it("blocks Production aliases", () => {
    expect(() => fastGatePreflight({
      PLAYWRIGHT_BASE_URL: "https://mtr-ai-demo.vercel.app",
      FASTGATE_ALLOW_PREVIEW: "true",
    }, "a".repeat(40))).toThrowError(new FastGateSafetyError("PRODUCTION_TARGET_FORBIDDEN"));
  });

  it("blocks cross-origin and unexpected mutations before sending", () => {
    expect(() => assertFastGateRequestAllowed("https://preview.example", "https://evil.example/api", "GET"))
      .toThrowError(new FastGateSafetyError("CROSS_ORIGIN_REQUEST_BLOCKED"));
    expect(() => assertFastGateRequestAllowed("https://preview.example", "/api/scenario-runs", "POST", {}))
      .toThrowError(new FastGateSafetyError("UNEXPECTED_MUTATION_ATTEMPT"));
    expect(() => assertFastGateRequestAllowed("https://preview.example", "/api/agent/actions/x/confirm", "POST", {}))
      .toThrowError(new FastGateSafetyError("UNEXPECTED_MUTATION_ATTEMPT"));
  });

  it("accepts only exact proposal-only schema and the owned cancel id", () => {
    const body = {
      schemaVersion: "fastgate-proposal-only-v1",
      operation: "PROPOSE",
      execute: false,
      caseId: "case-1",
      target: { type: "SYNTHETIC_USER", id: "synthetic-1" },
      actionType: "SET_USER_STATUS",
      idempotencyKey: crypto.randomUUID(),
    };
    expect(() => assertFastGateRequestAllowed("https://preview.example", "/api/agent/actions", "POST", body)).not.toThrow();
    expect(() => assertFastGateRequestAllowed("https://preview.example", "/api/agent/actions/owned/cancel", "POST", undefined, "owned")).not.toThrow();
    expect(() => assertFastGateRequestAllowed("https://preview.example", "/api/agent/actions/foreign/cancel", "POST", undefined, "owned"))
      .toThrowError(new FastGateSafetyError("UNEXPECTED_MUTATION_ATTEMPT"));
  });

  it("requires external credentials and metadata files to be 0600", () => {
    const dir = mkdtempSync(join(tmpdir(), "fastgate-safety-"));
    const file = join(dir, "credentials.json");
    writeFileSync(file, "{}", { mode: 0o600 });
    expect(() => assertCredentialsFileSafe(file)).not.toThrow();
    chmodSync(file, 0o644);
    expect(() => assertCredentialsFileSafe(file)).toThrowError(new FastGateSafetyError("CREDENTIALS_FILE_PERMISSIONS"));
  });
});
