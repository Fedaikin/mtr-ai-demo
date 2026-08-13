import { describe, expect, it } from "vitest";

import {
  generateSpecificationPortfolio,
  SPECIFICATION_PORTFOLIO_MANIFEST,
} from "@/adapters/mock/fixtures/specification-portfolio";

describe("synthetic Appius specification portfolio", () => {
  it("generates 80 additional specifications with distinct position counts", () => {
    const portfolio = generateSpecificationPortfolio();
    const positionCounts = portfolio.specifications.map((item) => item.positionCount);

    expect(portfolio.specifications).toHaveLength(80);
    expect(portfolio.specificationVersions).toHaveLength(80);
    expect(portfolio.positions).toHaveLength(3_560);
    expect(positionCounts).toEqual(Array.from({ length: 80 }, (_, index) => index + 5));
    expect(new Set(positionCounts).size).toBe(80);
    expect(Math.min(...positionCounts)).toBe(SPECIFICATION_PORTFOLIO_MANIFEST.minPositionCount);
    expect(Math.max(...positionCounts)).toBe(SPECIFICATION_PORTFOLIO_MANIFEST.maxPositionCount);
  });

  it("keeps versions, position ownership and catalogue references consistent", () => {
    const portfolio = generateSpecificationPortfolio();
    const versionBySpecification = new Map(
      portfolio.specificationVersions.map((version) => [version.specificationId, version]),
    );
    const positionsBySpecification = new Map<
      string,
      (typeof portfolio.positions)[number][]
    >();
    for (const position of portfolio.positions) {
      const saved = positionsBySpecification.get(position.specificationId) ?? [];
      saved.push(position);
      positionsBySpecification.set(position.specificationId, saved);
    }

    expect(new Set(portfolio.specifications.map((item) => item.id)).size).toBe(80);
    expect(new Set(portfolio.positions.map((item) => item.id)).size).toBe(3_560);
    expect(new Set(portfolio.positions.map((item) => item.internalCode)).size).toBe(3_560);

    for (const specification of portfolio.specifications) {
      const version = versionBySpecification.get(specification.id);
      const positions = positionsBySpecification.get(specification.id) ?? [];
      expect(version).toMatchObject({
        id: specification.latestVersionId,
        positionCount: specification.positionCount,
        isCurrent: true,
      });
      expect(positions).toHaveLength(specification.positionCount);
      expect(positions.every((position) => position.versionId === version?.id)).toBe(true);
      expect(
        positions.every(
          (position) =>
            position.classification.catalogItemCode === position.internalCode &&
            position.fixtureTags.includes("appius:portfolio") &&
            !position.fixtureTags.includes("catalog:incompatible-decoy"),
        ),
      ).toBe(true);
    }
  });
});
