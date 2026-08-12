import appius from "@/adapters/mock/fixtures/appius.json";
import identity from "@/adapters/mock/fixtures/identity.json";
import normative from "@/adapters/mock/fixtures/normative.json";
import sap from "@/adapters/mock/fixtures/sap.json";
import scenarios from "@/adapters/mock/fixtures/scenarios.json";
import { findBestMaterial } from "@/domain/matching";
import type { Position, SapMaterial } from "@/domain/models";

const DEMO_USER_ID = "demo-user-001";

function countTag(records: Array<{ fixtureTags?: string[] }>, tag: string): number {
  return records.filter((record) => record.fixtureTags?.includes(tag)).length;
}

describe("canonical mock fixture contract", () => {
  it("contains exactly 24 current Appius positions", () => {
    expect(appius.fixtureManifest.expectedCanonicalPositionCount).toBe(24);
    expect(appius.positions).toHaveLength(24);
    expect(appius.positions.every((item) => item.isCurrentVersion)).toBe(true);
    expect(new Set(appius.positions.map((item) => item.id)).size).toBe(24);
  });

  it("keeps every specification on its declared current version", () => {
    const currentVersions = appius.specificationVersions.filter((version) => version.isCurrent);

    expect(currentVersions).toHaveLength(3);
    expect(currentVersions.every((version) => version.status === "ACTIVE")).toBe(true);

    for (const specification of appius.specifications) {
      const current = currentVersions.find(
        (version) => version.specificationId === specification.id,
      );
      const canonicalPositions = appius.positions.filter(
        (item) => item.specificationId === specification.id,
      );

      expect(current?.id).toBe(specification.latestVersionId);
      expect(current?.versionNumber).toBe(specification.latestVersionNumber);
      expect(canonicalPositions).toHaveLength(specification.positionCount);
      expect(canonicalPositions.every((item) => item.versionId === current?.id)).toBe(true);
    }
  });

  it("contains exactly 30 SAP stock records with the declared 8/8/5/3/6 coverage", () => {
    expect(sap.fixtureManifest.expectedMaterialStockRecordCount).toBe(30);
    expect(sap.materials).toHaveLength(30);
    expect(new Set(sap.materials.map((item) => item.recordId)).size).toBe(30);

    const expected = {
      "case:exact": 8,
      "case:likely": 8,
      "case:review": 5,
      "case:no-match-decoy": 3,
      "case:analogue": 6,
    } as const;

    for (const [tag, count] of Object.entries(expected)) {
      expect(countTag(sap.materials, tag), tag).toBe(count);
      expect(
        (sap.fixtureManifest.expectedPrimaryTagCounts as Record<string, number>)[tag],
      ).toBe(count);
    }
  });

  it("declares position expectations as exactly 8 exact, 8 likely, 5 review and 3 no-match", () => {
    const categories = appius.positions.reduce<Record<string, number>>((counts, item) => {
      counts[item.expectedMatch.category] = (counts[item.expectedMatch.category] ?? 0) + 1;
      return counts;
    }, {});

    expect(categories).toEqual({ EXACT: 8, LIKELY: 8, REVIEW: 5, NO_MATCH: 3 });
    expect(sap.fixtureCoverage.exactTargetPositionIds).toHaveLength(8);
    expect(sap.fixtureCoverage.likelyTargetPositionIds).toHaveLength(8);
    expect(sap.fixtureCoverage.reviewTargetPositionIds).toHaveLength(5);
    expect(sap.fixtureCoverage.noMatchTargetPositionIds).toHaveLength(3);
  });

  it("reproduces the declared 8/8/5/3 golden set with the domain matcher", () => {
    const positions = appius.positions.map((item) => ({
      ...item,
      userId: item.user_id,
    })) as unknown as Position[];
    const materials = sap.materials.map((item) => ({
      ...item,
      id: item.recordId,
      userId: item.user_id,
      storageLocation: item.warehouse,
      snapshotAt: item.snapshotDate,
      cardUrl: item.materialCardUrl,
      sourcePositionId: item.expectedMatch?.targetPositionId,
    })) as unknown as SapMaterial[];
    const results = positions.map((item) => ({
      position: item,
      match: findBestMaterial(item, materials),
    }));
    const actualCounts = results.reduce<Record<string, number>>((counts, result) => {
      counts[result.match.category] = (counts[result.match.category] ?? 0) + 1;
      return counts;
    }, {});

    expect(actualCounts).toEqual({ EXACT: 8, LIKELY: 8, REVIEW: 5, NO_MATCH: 3 });
    for (const { position, match } of results) {
      expect(match.category, position.id).toBe(
        appius.positions.find((item) => item.id === position.id)?.expectedMatch.category,
      );
    }
  });

  it("provides all three composite and insufficient analogue coverage cases", () => {
    expect(sap.fixtureCoverage.analogueCoverage).toHaveLength(3);
    expect(
      sap.fixtureCoverage.analogueCoverage.map((item) => item.expectedCoverage),
    ).toEqual(["COMBINED_SUFFICIENT", "COMBINED_INSUFFICIENT", "SINGLE_SUFFICIENT"]);

    for (const coverage of sap.fixtureCoverage.analogueCoverage) {
      expect(
        coverage.materialCodes.reduce((sum, code) => {
          const record = sap.materials.find((item) => item.materialCode === code);
          expect(record, `missing SAP analogue ${code}`).toBeDefined();
          return sum + (record?.availableQuantity ?? 0);
        }, 0),
      ).toBe(coverage.combinedAvailableQuantity);
    }
  });

  it("contains one enabled set of five server scenarios", () => {
    expect(scenarios.fixtureManifest.expectedScenarioCount).toBe(5);
    expect(scenarios.scenarios).toHaveLength(5);
    expect(new Set(scenarios.scenarios.map((scenario) => scenario.id)).size).toBe(5);
    expect(scenarios.scenarios.every((scenario) => scenario.enabled)).toBe(true);
    expect(scenarios.scenarios.map((scenario) => scenario.sortOrder)).toEqual([1, 2, 3, 4, 5]);
  });

  it("exposes only the single Demo user across all fixture-owned entities", () => {
    const fixtureUserIds = [
      ...identity.users.map((item) => item.user_id),
      ...appius.specifications.map((item) => item.user_id),
      ...appius.specificationVersions.map((item) => item.user_id),
      ...appius.positions.map((item) => item.user_id),
      ...sap.materials.map((item) => item.user_id),
      ...normative.documents.map((item) => item.user_id),
      ...normative.chunks.map((item) => item.user_id),
      ...normative.responsibilityRules.map((item) => item.user_id),
      ...normative.analogueRules.map((item) => item.user_id),
      ...scenarios.scenarios.map((item) => item.user_id),
    ];

    expect(identity.users).toHaveLength(1);
    expect(identity.users[0]).toMatchObject({
      id: DEMO_USER_ID,
      displayName: "Демо-пользователь 1",
    });
    expect(new Set(fixtureUserIds)).toEqual(new Set([DEMO_USER_ID]));
    expect(identity.fixtureManifest.defaultUserId).toBe(DEMO_USER_ID);
    expect(
      [appius, normative, sap, scenarios].every(
        (fixture) => fixture.fixtureManifest.ownerUserId === DEMO_USER_ID,
      ),
    ).toBe(true);
  });

  it("marks manifests and operational fixture records as synthetic demo data", () => {
    const records: Array<{ isSyntheticDemo?: boolean }> = [
      ...identity.users,
      identity.authentication,
      ...appius.specifications,
      ...appius.specificationVersions,
      ...appius.positions,
      appius.integrationState,
      ...sap.materials,
      sap.integrationState,
      ...normative.documents,
      ...normative.chunks,
      ...normative.responsibilityRules,
      ...normative.analogueRules,
      ...scenarios.scenarios,
    ];

    expect(
      [appius, identity, normative, sap, scenarios].every(
        (fixture) => fixture.fixtureManifest.isSyntheticDemo,
      ),
    ).toBe(true);
    expect(records.every((record) => record.isSyntheticDemo === true)).toBe(true);
  });
});
