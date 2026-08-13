import { createHash } from "node:crypto";

import {
  INDUSTRIAL_CATALOGUE_MANIFEST,
  generateIndustrialCatalogue,
} from "@/adapters/mock/fixtures/industrial-catalogue";
import {
  CATALOGUE_CATEGORIES,
  catalogueItemCategory,
  isCatalogueDecoy,
  type CatalogueItem,
} from "@/domain/catalogue";

const catalogue = generateIndustrialCatalogue();
const itemById = new Map(catalogue.items.map((item) => [item.id, item]));
const familyById = new Map(catalogue.families.map((family) => [family.id, family]));

describe("deterministic industrial catalogue fixture", () => {
  it("reproduces the same complete dataset from the fixed seed", () => {
    const checksum = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");

    expect(checksum(generateIndustrialCatalogue())).toBe(
      "569fc614d1ce055359a2152900a9258fd9488d97795248cc9ee184cff0ff0721",
    );
    expect(generateIndustrialCatalogue()).toEqual(catalogue);
  });

  it("contains exactly 4,800 items with the declared component and assembly split", () => {
    const components = catalogue.items.filter((item) => item.itemKind === "COMPONENT");
    const assemblies = catalogue.items.filter((item) => item.itemKind === "ASSEMBLY");

    expect(catalogue.manifest).toEqual(INDUSTRIAL_CATALOGUE_MANIFEST);
    expect(catalogue.items).toHaveLength(4_800);
    expect(components).toHaveLength(4_320);
    expect(assemblies).toHaveLength(480);
    expect(catalogue.families).toHaveLength(960);

    for (const category of CATALOGUE_CATEGORIES) {
      expect(catalogue.families.filter((family) => family.code.includes(`-${categoryCode(category)}-`))).toHaveLength(160);
      expect(components.filter((item) => catalogueItemCategory(item) === category)).toHaveLength(720);
      expect(assemblies.filter((item) => catalogueItemCategory(item) === category)).toHaveLength(80);
    }
  });

  it("keeps every id and public code unique and stable", () => {
    expect(new Set(catalogue.items.map((item) => item.id)).size).toBe(4_800);
    expect(new Set(catalogue.items.map((item) => item.itemCode)).size).toBe(4_800);
    expect(new Set(catalogue.families.map((family) => family.id)).size).toBe(960);
    expect(new Set(catalogue.families.map((family) => family.code)).size).toBe(960);
    expect(new Set(catalogue.stockBalances.map((balance) => balance.id)).size).toBe(7_200);
    expect(new Set(catalogue.bomLinks.map((link) => link.id)).size).toBe(2_880);

    for (const item of catalogue.items) {
      const pattern = item.itemKind === "ASSEMBLY"
        ? /^CAT-DEMO-ASM-(PIP|VLV|INS|ELC|ROT|MRO)-\d{4}$/
        : /^CAT-DEMO-(PIP|VLV|INS|ELC|ROT|MRO)-\d{4}$/;
      expect(item.itemCode).toMatch(pattern);
      expect(item.manufacturer).toMatch(/^DEMO /);
      expect(item.standard).toMatch(/^DEMO-STD-/);
      expect(item.isSyntheticDemo).toBe(true);
    }
    expect(catalogue.families.every((family) => /^IG-DEMO-(PIP|VLV|INS|ELC|ROT|MRO)-\d{4}$/.test(family.code))).toBe(true);
  });

  it("creates four signature-compatible variants in every interchangeability family", () => {
    const membersByFamily = groupBy(
      catalogue.items.filter((item) => item.familyId !== null),
      (item) => item.familyId as string,
    );

    expect([...membersByFamily.values()].reduce((sum, members) => sum + members.length, 0)).toBe(3_840);
    for (const family of catalogue.families) {
      const members = membersByFamily.get(family.id) ?? [];
      expect(members, family.code).toHaveLength(4);
      expect(new Set(members.map((member) => member.manufacturer)).size, family.code).toBe(4);
      for (const member of members) {
        expect(member.itemKind).toBe("COMPONENT");
        expect(member.characteristics.compatibilityStatus).toBe("VALID_MEMBER");
        for (const [key, value] of Object.entries(family.compatibilitySignature)) {
          expect(member.characteristics[key], `${family.code}:${member.itemCode}:${key}`).toBe(value);
        }
      }
    }
  });

  it("adds one subtly incompatible, family-excluded decoy to every second family", () => {
    const decoys = catalogue.items.filter(isCatalogueDecoy);

    expect(decoys).toHaveLength(480);
    expect(decoys.every((item) => item.familyId === null)).toBe(true);
    for (const decoy of decoys) {
      const decoyForFamilyId = decoy.characteristics.decoyForFamilyId;
      expect(typeof decoyForFamilyId).toBe("string");
      const family = familyById.get(String(decoyForFamilyId));
      expect(family, decoy.itemCode).toBeDefined();
      expect(Number(family?.code.slice(-4)) % 2, family?.code).toBe(0);

      const differingSignatureKeys = Object.entries(family?.compatibilitySignature ?? {})
        .filter(([key, value]) => decoy.characteristics[key] !== value)
        .map(([key]) => key);
      expect(differingSignatureKeys, decoy.itemCode).toHaveLength(1);
      expect(decoy.fixtureTags).toContain("catalog:incompatible-decoy");
    }
  });

  it("provides exactly 7,200 non-negative multi-warehouse stock balances", () => {
    const balancesByItem = groupBy(catalogue.stockBalances, (balance) => balance.itemId);
    const balanceCounts = [...balancesByItem.values()].map((balances) => balances.length);
    const totalAvailable = catalogue.stockBalances.reduce(
      (sum, balance) => sum + balance.availableQuantity,
      0,
    );

    expect(catalogue.stockBalances).toHaveLength(7_200);
    expect(balancesByItem.size).toBe(4_800);
    expect(balanceCounts.filter((count) => count === 2)).toHaveLength(2_400);
    expect(balanceCounts.filter((count) => count === 1)).toHaveLength(2_400);
    expect(Number.isInteger(totalAvailable)).toBe(true);

    for (const [itemId, balances] of balancesByItem) {
      const item = itemById.get(itemId);
      expect(item, itemId).toBeDefined();
      expect(balances.every((balance) => balance.availableQuantity >= 0)).toBe(true);
      expect(balances.every((balance) => Number.isInteger(balance.availableQuantity))).toBe(true);
      expect(balances.every((balance) => balance.unit === item?.unit)).toBe(true);
      expect(balances.every((balance) => balance.snapshotAt === catalogue.manifest.snapshotAt)).toBe(true);
      expect(new Set(balances.map((balance) => `${balance.plant}/${balance.storageLocation}`)).size).toBe(balances.length);
    }
  });

  it("builds six valid component links per assembly without cycles or decoys", () => {
    const linksByAssembly = groupBy(catalogue.bomLinks, (link) => link.assemblyItemId);
    const usesByFamily = groupBy(catalogue.bomLinks, (link) => link.alternativeFamilyId);
    const decoyIds = new Set(catalogue.items.filter(isCatalogueDecoy).map((item) => item.id));

    expect(catalogue.bomLinks).toHaveLength(2_880);
    expect(linksByAssembly.size).toBe(480);
    expect(usesByFamily.size).toBe(960);
    expect([...usesByFamily.values()].every((links) => links.length === 3)).toBe(true);

    for (const [assemblyId, links] of linksByAssembly) {
      expect(itemById.get(assemblyId)?.itemKind).toBe("ASSEMBLY");
      expect(links, assemblyId).toHaveLength(6);
      expect(new Set(links.map((link) => link.positionNumber)).size).toBe(6);
      for (const link of links) {
        const component = itemById.get(link.componentItemId);
        expect(component?.itemKind, link.id).toBe("COMPONENT");
        expect(decoyIds.has(link.componentItemId), link.id).toBe(false);
        expect(component?.familyId, link.id).toBe(link.alternativeFamilyId);
        expect(link.quantity).toBeGreaterThan(0);
        expect(link.unit).toBe(component?.unit);
      }
    }

    expect(hasBomCycle(catalogue.items, catalogue.bomLinks)).toBe(false);
  });

  it("exposes a representative agent-regression sample with compatible alternatives and a decoy", () => {
    const sample = catalogue.manifest.representative;
    const family = catalogue.families.find((candidate) => candidate.code === sample.familyCode);
    const target = catalogue.items.find((item) => item.itemCode === sample.itemCode);
    const alternatives = sample.compatibleItemCodes.map((code) =>
      catalogue.items.find((item) => item.itemCode === code),
    );
    const decoy = catalogue.items.find((item) => item.itemCode === sample.incompatibleDecoyCode);
    const assembly = catalogue.items.find((item) => item.itemCode === sample.assemblyCode);

    expect(family).toBeDefined();
    expect(target?.familyId).toBe(family?.id);
    expect(alternatives.every((item) => item?.familyId === family?.id)).toBe(true);
    expect(decoy?.familyId).toBeNull();
    expect(decoy?.characteristics.decoyForFamilyId).toBe(family?.id);
    expect(assembly?.itemKind).toBe("ASSEMBLY");
    expect(catalogue.bomLinks.filter((link) => link.assemblyItemId === assembly?.id)).toHaveLength(6);
  });
});

function categoryCode(category: (typeof CATALOGUE_CATEGORIES)[number]): string {
  return {
    PIPING: "PIP",
    VALVES: "VLV",
    INSTRUMENTATION: "INS",
    ELECTRICAL: "ELC",
    ROTATING: "ROT",
    MRO: "MRO",
  }[category];
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    grouped.set(value, [...(grouped.get(value) ?? []), item]);
  }
  return grouped;
}

function hasBomCycle(
  items: readonly CatalogueItem[],
  links: readonly { assemblyItemId: string; componentItemId: string }[],
): boolean {
  const graph = groupBy(links, (link) => link.assemblyItemId);
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (itemId: string): boolean => {
    if (visiting.has(itemId)) return true;
    if (visited.has(itemId)) return false;
    visiting.add(itemId);
    for (const link of graph.get(itemId) ?? []) {
      if (visit(link.componentItemId)) return true;
    }
    visiting.delete(itemId);
    visited.add(itemId);
    return false;
  };

  return items.some((item) => visit(item.id));
}
