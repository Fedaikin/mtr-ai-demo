import { generateIndustrialCatalogue } from "@/adapters/mock/fixtures/industrial-catalogue";

const OWNER_USER_ID = "demo-user-001";
const FIRST_PORTFOLIO_NUMBER = 4;
const PORTFOLIO_SPECIFICATION_COUNT = 80;
const MIN_POSITION_COUNT = 5;

const PROJECT_AREAS = [
  "Установка подготовки нефти",
  "Насосная станция",
  "Компрессорный цех",
  "Резервуарный парк",
  "Узел коммерческого учёта",
  "Система оборотного водоснабжения",
  "Главная понизительная подстанция",
  "Эстакада технологических трубопроводов",
  "Блок реагентного хозяйства",
  "Установка очистки газа",
] as const;

export const SPECIFICATION_PORTFOLIO_MANIFEST = Object.freeze({
  fixtureId: "appius-portfolio-v1",
  schemaVersion: "1.0.0",
  ownerUserId: OWNER_USER_ID,
  expectedSpecificationCount: PORTFOLIO_SPECIFICATION_COUNT,
  expectedVersionCount: PORTFOLIO_SPECIFICATION_COUNT,
  expectedPositionCount: 3_560,
  expectedAssemblyPositionCount: 24,
  minPositionCount: MIN_POSITION_COUNT,
  maxPositionCount: MIN_POSITION_COUNT + PORTFOLIO_SPECIFICATION_COUNT - 1,
  isSyntheticDemo: true,
});

export interface PortfolioSpecificationFixture {
  id: string;
  user_id: string;
  projectCode: string;
  name: string;
  latestVersionId: string;
  latestVersionNumber: number;
  positionCount: number;
  access: "DEMO_USER";
  isSyntheticDemo: true;
}

export interface PortfolioVersionFixture {
  id: string;
  specificationId: string;
  user_id: string;
  versionNumber: number;
  isCurrent: true;
  status: "ACTIVE";
  effectiveAt: string;
  positionCount: number;
  access: "DEMO_USER";
  isSyntheticDemo: true;
}

export interface PortfolioPositionFixture {
  id: string;
  specificationId: string;
  versionId: string;
  user_id: string;
  internalCode: string;
  nameRu: string;
  nameEn: string;
  synonyms: string[];
  equipmentType: string;
  standard: string;
  materialGrade: string;
  dimensions: Record<string, string | number | boolean | null>;
  requiredQuantity: number;
  unit: string;
  classification: Record<string, string>;
  access: "DEMO_USER";
  fixtureTags: string[];
  isSyntheticDemo: true;
}

export interface SpecificationPortfolioFixture {
  specifications: PortfolioSpecificationFixture[];
  specificationVersions: PortfolioVersionFixture[];
  positions: PortfolioPositionFixture[];
}

export function generateSpecificationPortfolio(): SpecificationPortfolioFixture {
  const catalogue = generateIndustrialCatalogue();
  const validComponents = catalogue.items.filter(
    (item) =>
      item.itemKind === "COMPONENT" &&
      item.characteristics.compatibilityStatus === "VALID_MEMBER",
  );
  const requiredPositionCount = SPECIFICATION_PORTFOLIO_MANIFEST.expectedPositionCount;
  const assemblies = catalogue.items.filter((item) => item.itemKind === "ASSEMBLY");
  const requiredComponentCount =
    requiredPositionCount - SPECIFICATION_PORTFOLIO_MANIFEST.expectedAssemblyPositionCount;
  if (
    validComponents.length < requiredComponentCount ||
    assemblies.length < SPECIFICATION_PORTFOLIO_MANIFEST.expectedAssemblyPositionCount
  ) {
    throw new Error(
      "Недостаточно компонентов или сборок промышленного каталога для портфеля.",
    );
  }

  const specifications: PortfolioSpecificationFixture[] = [];
  const specificationVersions: PortfolioVersionFixture[] = [];
  const positions: PortfolioPositionFixture[] = [];
  let componentOffset = 0;
  let assemblyOffset = 0;

  for (let index = 0; index < PORTFOLIO_SPECIFICATION_COUNT; index += 1) {
    const ordinal = FIRST_PORTFOLIO_NUMBER + index;
    const suffix = pad(ordinal, 3);
    const specificationId = `spec-demo-portfolio-${suffix}`;
    const versionNumber = 1 + (index % 4);
    const versionId = `${specificationId}-v${versionNumber}`;
    const positionCount = MIN_POSITION_COUNT + index;
    const projectOrdinal = 1 + Math.floor(index / 4);
    const area = PROJECT_AREAS[index % PROJECT_AREAS.length];

    specifications.push({
      id: specificationId,
      user_id: OWNER_USER_ID,
      projectCode: `PROJECT-MTR-${pad(projectOrdinal, 3)}`,
      name: `${area} — рабочая спецификация ${suffix}`,
      latestVersionId: versionId,
      latestVersionNumber: versionNumber,
      positionCount,
      access: "DEMO_USER",
      isSyntheticDemo: true,
    });
    specificationVersions.push({
      id: versionId,
      specificationId,
      user_id: OWNER_USER_ID,
      versionNumber,
      isCurrent: true,
      status: "ACTIVE",
      effectiveAt: portfolioEffectiveAt(index),
      positionCount,
      access: "DEMO_USER",
      isSyntheticDemo: true,
    });

    for (let positionIndex = 0; positionIndex < positionCount; positionIndex += 1) {
      const useAssembly = index >= 68 && positionIndex < 2;
      const item = useAssembly
        ? assemblies[assemblyOffset]
        : validComponents[componentOffset];
      if (!item) throw new Error("Портфель спецификаций вышел за границы каталога.");
      if (useAssembly) assemblyOffset += 1;
      else componentOffset += 1;
      positions.push({
        id: `position-portfolio-${suffix}-${pad(positionIndex + 1, 3)}`,
        specificationId,
        versionId,
        user_id: OWNER_USER_ID,
        internalCode: item.itemCode,
        nameRu: item.nameRu,
        nameEn: item.nameEn,
        synonyms: [...item.synonyms],
        equipmentType: item.equipmentType,
        standard: item.standard,
        materialGrade: item.materialGrade,
        dimensions: { ...item.characteristics },
        requiredQuantity: requiredQuantity(item.unit, index, positionIndex),
        unit: item.unit,
        classification: {
          source: "APPIUS_PORTFOLIO",
          catalogItemCode: item.itemCode,
          catalogFamilyId: item.familyId ?? "",
          manufacturer: item.manufacturer,
          category: item.characteristics.category,
          itemKind: item.itemKind,
        },
        access: "DEMO_USER",
        fixtureTags: [
          "appius:portfolio",
          `portfolio-spec:${suffix}`,
          ...item.fixtureTags,
        ],
        isSyntheticDemo: true,
      });
    }
  }

  if (
    assemblyOffset !== SPECIFICATION_PORTFOLIO_MANIFEST.expectedAssemblyPositionCount ||
    componentOffset !== requiredComponentCount
  ) {
    throw new Error("Нарушено ожидаемое распределение компонентов и сборок портфеля.");
  }

  return { specifications, specificationVersions, positions };
}

function requiredQuantity(unit: string, specificationIndex: number, positionIndex: number): number {
  const base = 1 + ((specificationIndex * 11 + positionIndex * 7) % 48);
  if (unit === "M") return base * 5;
  if (unit === "KG") return base * 2;
  return base;
}

function portfolioEffectiveAt(index: number): string {
  const date = new Date("2026-01-15T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + index * 2);
  return date.toISOString();
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}
