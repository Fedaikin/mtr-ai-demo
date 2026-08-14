import { describe, expect, test } from "vitest";

import {
  createFixedScenarioClock,
  moscowCalendarDay,
} from "@/domain/agent/universal-chat/scenario-clock";
import { generateUniversalChatDataset } from "@/adapters/mock/fixtures/universal-chat-dataset";

const CLOCK = createFixedScenarioClock("2026-08-13T09:15:00.000Z");

describe("universal-chat-v1 foundation", () => {
  test("uses an injectable Europe/Moscow clock for calendar-day semantics", () => {
    expect(CLOCK.timeZone).toBe("Europe/Moscow");
    expect(CLOCK.now().toISOString()).toBe("2026-08-13T09:15:00.000Z");
    expect(moscowCalendarDay(CLOCK)).toEqual({
      localDate: "2026-08-13",
      startsAt: "2026-08-12T21:00:00.000Z",
      endsAtExclusive: "2026-08-13T21:00:00.000Z",
    });
  });

  test("covers every current specification and position with business-project and operational links", () => {
    const dataset = generateUniversalChatDataset(CLOCK);

    expect(dataset.manifest.datasetId).toBe("universal-chat-v1");
    expect(dataset.manifest.timeZone).toBe("Europe/Moscow");
    expect(dataset.manifest.expectedCounts).toMatchObject({
      accessProjects: 1,
      businessProjects: 22,
      specifications: 83,
      currentPositions: 3_584,
      catalogItems: 4_800,
      operationalMaterials: 4_800,
      specificationIntakes: 83,
    });
    expect(dataset.businessProjects).toHaveLength(22);
    expect(dataset.specificationLinks).toHaveLength(83);
    expect(dataset.positionLinks).toHaveLength(3_584);
    expect(dataset.operationalMaterials).toHaveLength(4_800);

    const projectIds = new Set(dataset.businessProjects.map((project) => project.id));
    const operationalByCode = new Map(
      dataset.operationalMaterials.map((material) => [material.materialCode, material]),
    );
    const specificationById = new Map(
      dataset.specificationLinks.map((link) => [link.specificationId, link]),
    );

    expect(new Set(dataset.specificationLinks.map((link) => link.specificationId)).size).toBe(83);
    expect(new Set(dataset.positionLinks.map((link) => link.positionId)).size).toBe(3_584);
    for (const specification of dataset.specificationLinks) {
      expect(projectIds.has(specification.businessProjectId)).toBe(true);
      expect(specification.accessProjectId).toBe("demo-project-001");
      expect(specification.currentVersionId).not.toBe("");
    }
    for (const position of dataset.positionLinks) {
      const specification = specificationById.get(position.specificationId);
      expect(specification?.businessProjectId).toBe(position.businessProjectId);
      expect(position.projectAssociationConfidencePercent).toBe(100);
      expect(position.catalogItemCode).not.toBeNull();
      const material = operationalByCode.get(position.operationalMaterialCode);
      expect(material?.catalogItemCode).toBe(position.catalogItemCode);
      expect(material?.weeklyMovements).toHaveLength(52);
      expect(material?.stock).toEqual(expect.objectContaining({
        onHandQuantity: expect.any(Number),
        reservedQuantity: expect.any(Number),
        quarantinedQuantity: expect.any(Number),
        committedToOtherNeeds: expect.any(Number),
      }));
      expect(material?.inboundSupplies.length).toBeGreaterThan(0);
      expect(material?.leadTimeDays).toBeGreaterThan(0);
    }
  });

  test("creates complete project deadlines and a linked specification intake lifecycle", () => {
    const dataset = generateUniversalChatDataset(CLOCK);

    for (const project of dataset.businessProjects) {
      expect(project.accessProjectId).toBe("demo-project-001");
      expect(project.status).toMatch(/^(PLANNED|ACTIVE|ON_HOLD|COMPLETED)$/);
      expect(project.phase).toMatch(/^(DESIGN|PROCUREMENT|CONSTRUCTION|COMMISSIONING|OPERATIONS)$/);
      expect(project.needDate).toMatch(/^2026-/);
      expect(project.deadlines.length).toBeGreaterThan(0);
    }

    expect(dataset.specificationIntakes).toHaveLength(83);
    expect(new Set(dataset.specificationIntakes.map((item) => item.idempotencyKey)).size).toBe(83);
    for (const item of dataset.specificationIntakes) {
      expect(item.businessProjectId).not.toBe("");
      expect(item.version).toBeGreaterThan(0);
      expect(item.auditCorrelationId).not.toBe("");
      expect(item.slaDeadline).not.toBe("");
      if (item.status === "PROCESSING") {
        expect(item.runId).not.toBeNull();
        expect(item.eventIds.length).toBeGreaterThan(0);
      }
      if (item.status === "NEEDS_REVIEW") {
        expect(item.taskId).not.toBeNull();
        expect(item.assignedActorId).not.toBeNull();
      }
      if (item.status === "FAILED") {
        expect(item.safeErrorCategory).not.toBeNull();
      }
    }
  });

  test("selects reference projects by data traits rather than hard-coded names", () => {
    const dataset = generateUniversalChatDataset(CLOCK);
    const references = dataset.manifest.referenceProjectIds;
    const byId = new Map(dataset.businessProjects.map((project) => [project.id, project]));

    expect(Object.values(references).every((id) => byId.has(id))).toBe(true);
    expect(dataset.positionLinks.filter(
      (position) =>
        position.businessProjectId === references.pipeRichProjectId &&
        position.equipmentType === "PIPE",
    ).length).toBeGreaterThanOrEqual(24);
    expect(dataset.specificationLinks.filter(
      (specification) => specification.businessProjectId === references.pipeRichProjectId,
    ).length).toBeGreaterThanOrEqual(3);
    expect(dataset.specificationLinks.some(
      (specification) =>
        specification.businessProjectId === references.pipeRichProjectId &&
        specification.purpose === "CONSTRUCTION",
    )).toBe(true);
    expect(dataset.specificationLinks.some(
      (specification) =>
        specification.businessProjectId === references.pipeRichProjectId &&
        specification.purpose === "MAINTENANCE",
    )).toBe(true);
    expect(dataset.businessProjects.find(
      (project) => project.id === references.nearestDeadlineProjectId,
    )?.deadlines.some((deadline) => deadline.daysFromScenarioToday <= 3)).toBe(true);
    expect(dataset.positionLinks.some(
      (position) =>
        position.businessProjectId === references.noPipeProjectId &&
        position.equipmentType === "PIPE",
    )).toBe(false);
  });

  test("is deterministic for an identical fixed clock", () => {
    const first = generateUniversalChatDataset(CLOCK);
    const second = generateUniversalChatDataset(createFixedScenarioClock("2026-08-13T09:15:00.000Z"));

    expect(second.manifest.checksum).toBe(first.manifest.checksum);
    expect(second.manifest.referenceProjectIds).toEqual(first.manifest.referenceProjectIds);
  });
});
