import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { NormativeMockAdapter } from "@/adapters/mock/normative-adapter";
import { resetDemoDatabase } from "@/adapters/persistence/bootstrap";
import { closeDatabase } from "@/adapters/persistence/db";
import { getRepository, type MtrRepository } from "@/adapters/persistence/repository";
import { createAgentRuntime } from "@/app/api/agent/_shared";
import { ScenarioService } from "@/application/scenario-service";
import { DEMO_USER_ID } from "@/domain/models";

describe.sequential("normative RAG and executable agent integration states", () => {
  let repository: MtrRepository;

  beforeEach(async () => {
    await resetDemoDatabase(DEMO_USER_ID);
    repository = await getRepository();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("ranks bilingual normative chunks with exact citation and metadata evidence", async () => {
    const position = await repository.getPosition(DEMO_USER_ID, "position-022");
    expect(position).toBeTruthy();

    const rules = await new NormativeMockAdapter(repository).searchAnalogueRules(
      position!,
      DEMO_USER_ID,
    );

    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      documentId: "TU-DEMO-PUMP-ALT-001",
      version: "1.0-DEMO",
      clauseId: "TU-PUMP-ALT-4.2",
      isSyntheticDemo: true,
      retrievalEvidence: {
        chunkId: expect.stringMatching(/^chunk-tu-pump-4-2-(?:ru|en)$/u),
        language: expect.stringMatching(/^(?:ru|en)$/u),
        score: expect.any(Number),
        matchedAttributes: expect.arrayContaining([
          "equipmentType",
          "pumpKind",
          "requiredMaterialGroup",
        ]),
      },
    });
    expect(rules[0]!.retrievalEvidence!.score).toBeGreaterThan(0.7);
    expect(rules[0]!.retrievalEvidence!.lexicalScore).toBeGreaterThan(0);
    expect(rules[0]!.retrievalEvidence!.semanticScore).toBeGreaterThan(0);
  });

  it("uses an active admin dictionary value to resolve a position and retrieve cited rules", async () => {
    const pumpDictionary = (await repository.listDictionaries(
      DEMO_USER_ID,
      "MTR_SEARCH_SYNONYMS",
    )).find((item) => item.key === "PUMP");
    expect(pumpDictionary).toBeTruthy();
    await repository.updateDictionary(
      DEMO_USER_ID,
      pumpDictionary!.id,
      { values: [...pumpDictionary!.values, "перекачивающий модуль"] },
      pumpDictionary!.version,
    );

    const output = await createAgentRuntime(repository).respond(
      { message: "Кто отвечает за перекачивающий модуль?" },
      DEMO_USER_ID,
    );

    expect(output.answer).toContain("Заказчик");
    expect(output.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "norms.searchResponsibilityRules", outcome: "OK" }),
      ]),
    );
    expect(output.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceSystem: "NORMATIVE",
          entityId: "КТ-374-DEMO",
          versionOrSnapshot: "1.0-DEMO",
          clauseId: "КТ-DEMO-2.3",
        }),
      ]),
    );
  });

  it("fails the normative tool safely and audibly when admin sets RAG unavailable", async () => {
    await repository.setIntegrationState(DEMO_USER_ID, "RAG", {
      state: "UNAVAILABLE",
      delayMs: 0,
      safeMessage: "Нормативный индекс временно недоступен.",
    });

    const output = await createAgentRuntime(repository).respond(
      { message: "Кто отвечает за position-001?" },
      DEMO_USER_ID,
    );

    expect(output.answer).toMatch(/Нормативное хранилище.*недоступ/iu);
    expect(output.requiresHumanReview).toBe(true);
    expect(output.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "norms.searchResponsibilityRules", outcome: "ERROR" }),
      ]),
    );
    expect(output.citations.some((citation) => citation.sourceSystem === "NORMATIVE")).toBe(false);
    const audit = await repository.listAuditLogs(DEMO_USER_ID, {
      action: "agent.tool.result",
      outcome: "FAILURE",
    });
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: "position-001",
          details: expect.objectContaining({
            tool: "norms.searchResponsibilityRules",
            errorCode: "RAG_UNAVAILABLE",
          }),
        }),
      ]),
    );
  });

  it("makes the LLM admin state control the real provider call without losing tool citations", async () => {
    await repository.setIntegrationState(DEMO_USER_ID, "LLM", {
      state: "RATE_LIMITED",
      delayMs: 0,
      safeMessage: "Лимит демонстрационного LLM исчерпан.",
    });

    const output = await createAgentRuntime(repository).respond(
      { message: "Какой остаток SAP-DEMO-0001?" },
      DEMO_USER_ID,
    );

    expect(output.answer).toMatch(/LLM-провайдер.*ограничил/iu);
    expect(output.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "sap.getMaterialStock", outcome: "OK" }),
        expect.objectContaining({ tool: "llm.respond", outcome: "ERROR" }),
      ]),
    );
    expect(output.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceSystem: "SAP", entityId: "SAP-DEMO-0001" }),
      ]),
    );
    const audit = await repository.listAuditLogs(DEMO_USER_ID, {
      action: "agent.tool.result",
      outcome: "FAILURE",
    });
    expect(audit[0]?.details).toMatchObject({
      tool: "llm.respond",
      errorCode: "LLM_RATE_LIMITED",
    });
  });

  it("persists an exact RAG failure code when a server scenario reaches classification", async () => {
    await repository.setIntegrationState(DEMO_USER_ID, "RAG", {
      state: "MALFORMED_RESPONSE",
      delayMs: 0,
      safeMessage: "Нормативный ответ не прошёл проверку.",
    });
    const service = new ScenarioService(repository);
    let run = await service.createRun(DEMO_USER_ID, {
      scenarioId: "scenario-full-analysis",
      specificationId: "spec-demo-piping-001",
    });
    run = await service.advance(DEMO_USER_ID, run.id, run.version);
    run = await service.advance(DEMO_USER_ID, run.id, run.version);
    run = await service.advance(DEMO_USER_ID, run.id, run.version);

    expect(run).toMatchObject({
      status: "FAILED",
      currentStep: "CLASSIFYING_RESPONSIBILITY",
      errorCode: "RAG_MALFORMED_RESPONSE",
      errorMessage: "Нормативный ответ не прошёл проверку.",
    });
    expect(run.outputSnapshot.failure).toMatchObject({
      step: "CLASSIFYING_RESPONSIBILITY",
      code: "RAG_MALFORMED_RESPONSE",
      recommendedAction: "RETRY",
    });
  });
});
