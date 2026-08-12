import { performance } from "node:perf_hooks";

import appiusFixture from "../src/adapters/mock/fixtures/appius.json";
import sapFixture from "../src/adapters/mock/fixtures/sap.json";
import { findBestMaterial } from "../src/domain/matching";
import type { Position, SapMaterial } from "../src/domain/models";

const BENCHMARK_ID = "BENCH-10K-001";
const RECORD_COUNT = 10_000;
const WARMUP_ITERATIONS = 1;
const MEASURED_ITERATIONS = 5;
const TARGET_POSITION_ID = "position-001";

function main(): void {
  const position = createPosition();
  const materials = createSyntheticMaterials();

  for (let index = 0; index < WARMUP_ITERATIONS; index += 1) {
    findBestMaterial(position, materials);
  }

  const heapBefore = process.memoryUsage().heapUsed;
  const durations: number[] = [];
  const signatures = new Set<string>();
  let finalResult = findBestMaterial(position, materials);

  for (let index = 0; index < MEASURED_ITERATIONS; index += 1) {
    const startedAt = performance.now();
    finalResult = findBestMaterial(position, materials);
    durations.push(performance.now() - startedAt);
    signatures.add(
      `${finalResult.category}:${finalResult.score}:${finalResult.material?.materialCode ?? "none"}`,
    );
  }

  if (materials.length !== RECORD_COUNT || signatures.size !== 1) {
    throw new Error("Benchmark не воспроизводим: размер набора или результат изменился.");
  }
  if (finalResult.category !== "EXACT" || finalResult.score !== 100 || !finalResult.material) {
    throw new Error("Benchmark не прошёл функциональную проверку ожидаемого точного совпадения.");
  }

  const heapAfter = process.memoryUsage().heapUsed;
  const sortedDurations = durations.toSorted((left, right) => left - right);
  const report = {
    benchmarkId: BENCHMARK_ID,
    dataset: {
      targetPositions: 1,
      sapRecords: materials.length,
      sourceFixtureRecords: sapFixture.materials.length,
      synthetic: true,
    },
    execution: {
      warmupIterations: WARMUP_ITERATIONS,
      measuredIterations: MEASURED_ITERATIONS,
      durationsMs: durations.map(round),
      minMs: round(sortedDurations[0] ?? 0),
      medianMs: round(percentile(sortedDurations, 0.5)),
      p95Ms: round(percentile(sortedDurations, 0.95)),
      maxMs: round(sortedDurations.at(-1) ?? 0),
      approximateHeapDeltaMiB: round((heapAfter - heapBefore) / 1024 / 1024),
    },
    deterministicResult: {
      category: finalResult.category,
      score: finalResult.score,
      materialCode: finalResult.material.materialCode,
    },
    limitation:
      "Микробенчмарк чистой доменной функции не подтверждает промышленный SLA, конкурентную нагрузку или производительность БД.",
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function createPosition(): Position {
  const source = appiusFixture.positions.find((position) => position.id === TARGET_POSITION_ID);
  if (!source) throw new Error(`Fixture-позиция ${TARGET_POSITION_ID} не найдена.`);
  return {
    id: source.id,
    userId: source.user_id,
    internalCode: source.internalCode,
    nameRu: source.nameRu,
    nameEn: source.nameEn,
    synonyms: [...source.synonyms],
    equipmentType: source.equipmentType,
    standard: source.standard,
    materialGrade: source.materialGrade,
    dimensions: toDimensions(source.dimensions),
    requiredQuantity: source.requiredQuantity,
    unit: source.unit,
    specificationId: source.specificationId,
    specificationName: source.specificationName,
    versionId: source.versionId,
    versionNumber: source.versionNumber,
    isCurrentVersion: source.isCurrentVersion,
    classification: { ...source.classification },
    access: { ...source.access },
    fixtureTags: [...source.fixtureTags],
  };
}

function createSyntheticMaterials(): SapMaterial[] {
  if (sapFixture.materials.length !== 30) {
    throw new Error("Базовый SAP fixture должен содержать ровно 30 записей.");
  }
  return Array.from({ length: RECORD_COUNT }, (_, index) => {
    const source = sapFixture.materials[index % sapFixture.materials.length];
    if (!source) throw new Error("Не удалось построить синтетический SAP-набор.");
    const suffix = String(index).padStart(5, "0");
    return {
      id: `benchmark-stock-${suffix}`,
      userId: source.user_id,
      materialCode: `${source.materialCode}-BENCH-${suffix}`,
      nameRu: source.nameRu,
      nameEn: source.nameEn,
      synonyms: [...source.synonyms],
      legacyCode: source.legacyCode,
      equipmentType: source.equipmentType,
      standard: source.standard,
      materialGrade: source.materialGrade,
      dimensions: toDimensions(source.dimensions),
      tolerances: toDimensions(source.tolerances),
      plant: source.plant,
      storageLocation: source.warehouse,
      batch: source.batch,
      availableQuantity: source.availableQuantity,
      unit: source.unit,
      snapshotAt: source.snapshotDate,
      cardUrl: source.materialCardUrl,
      fixtureTags: [...source.fixtureTags],
      ...(source.expectedMatch?.targetPositionId
        ? { sourcePositionId: source.expectedMatch.targetPositionId }
        : {}),
    };
  });
}

function percentile(sortedValues: number[], quantile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * quantile) - 1);
  return sortedValues[index] ?? 0;
}

function toDimensions(input: Record<string, unknown>): Position["dimensions"] {
  const dimensions: Position["dimensions"] = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "string" ||
      typeof value === "boolean"
    ) {
      dimensions[key] = value;
    }
  }
  return dimensions;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Benchmark завершился ошибкой.");
  process.exitCode = 1;
}
