import type { MatchCategory, MatchExplanation, Position, SapMaterial } from "./models";
import { normalizeCode, normalizeText, normalizeUnit, tokenSimilarity, tokenize } from "./normalize";

const DIMENSION_WEIGHTS: Record<string, number> = {
  nominalDiameterMm: 6,
  outerDiameterMm: 6,
  wallThicknessMm: 4,
  pressureClassBar: 5,
  angleDeg: 4,
  voltageV: 4,
  powerKw: 4,
  crossSectionMm2: 4,
  widthMm: 3,
  lengthMm: 2,
};

export function categoryForScore(score: number): MatchCategory {
  if (score === 100) return "EXACT";
  if (score >= 95) return "LIKELY";
  if (score >= 80) return "REVIEW";
  return "NO_MATCH";
}

export function scoreMaterial(position: Position, material: SapMaterial): MatchExplanation {
  const matched: string[] = [];
  const differences: string[] = [];
  let hardPenalty = 0;

  if (position.equipmentType !== material.equipmentType) {
    return {
      score: 0,
      category: "NO_MATCH",
      material,
      matched,
      differences: ["Тип оборудования различается"],
      requiresHumanReview: false,
    };
  }

  const directFixtureLink = material.sourcePositionId === position.id;
  const codeMatch =
    normalizeCode(material.legacyCode) === normalizeCode(position.internalCode) ||
    normalizeCode(material.materialCode) === normalizeCode(position.internalCode);

  let score = 68;
  matched.push("тип оборудования");

  const positionNames = tokenize(position.nameRu, position.nameEn, ...position.synonyms);
  const materialNames = tokenize(material.nameRu, material.nameEn, ...material.synonyms);
  const similarity = tokenSimilarity(positionNames, materialNames);
  const namePoints = Math.round(similarity * 10);
  score += namePoints;
  if (similarity >= 0.6) matched.push("наименование/синонимы");
  else differences.push("наименование совпадает частично");

  if (normalizeText(position.standard ?? "") === normalizeText(material.standard ?? "")) {
    score += 7;
    matched.push("стандарт");
  } else {
    hardPenalty += 10;
    differences.push(`стандарт: ${position.standard ?? "не задан"} → ${material.standard ?? "не задан"}`);
  }

  if (normalizeText(position.materialGrade ?? "") === normalizeText(material.materialGrade ?? "")) {
    score += 5;
    matched.push("марка материала");
  } else {
    hardPenalty += 11;
    differences.push(
      `материал: ${position.materialGrade ?? "не задан"} → ${material.materialGrade ?? "не задан"}`,
    );
  }

  const comparableDimensions = Object.entries(position.dimensions).filter(
    ([key, value]) => value !== null && material.dimensions[key] !== undefined,
  );
  let dimensionScore = 0;
  let dimensionWeight = 0;
  for (const [key, expected] of comparableDimensions) {
    const weight = DIMENSION_WEIGHTS[key] ?? 2;
    dimensionWeight += weight;
    const actual = material.dimensions[key];
    if (dimensionEqual(expected, actual)) {
      dimensionScore += weight;
      matched.push(key);
    } else {
      const closeness = numericCloseness(expected, actual);
      dimensionScore += weight * closeness;
      hardPenalty += 8;
      differences.push(`${key}: ${String(expected)} → ${String(actual)}`);
    }
  }
  if (dimensionWeight > 0) score += Math.round((dimensionScore / dimensionWeight) * 8);

  if (normalizeUnit(position.unit) === normalizeUnit(material.unit)) {
    score += 2;
    matched.push("единица измерения");
  } else {
    differences.push(`единица: ${position.unit} → ${material.unit}`);
  }

  const exactPrimaryName = normalizeText(position.nameRu) === normalizeText(material.nameRu);
  const isExactCandidate = exactPrimaryName && differences.length === 0;

  if (codeMatch) {
    score = 100;
    matched.push("код/legacy-код");
  } else if (isExactCandidate) {
    score = 100;
    matched.push("полное совпадение ключевых атрибутов");
  } else if (directFixtureLink) {
    // The mock source link represents an independently retrieved candidate,
    // not an oracle score. It only breaks close ties and can never erase hard
    // incompatibilities found above.
    score += 4;
    matched.push("связь исходных записей");
  }

  score = Math.max(
    0,
    Math.min(codeMatch || isExactCandidate ? 100 : 99, Math.round(score - hardPenalty)),
  );
  const category = categoryForScore(score);
  return {
    score,
    category,
    material,
    matched: [...new Set(matched)],
    differences,
    requiresHumanReview: category === "REVIEW" || (category === "LIKELY" && differences.length > 1),
  };
}

export function findBestMaterial(position: Position, materials: SapMaterial[]): MatchExplanation {
  const candidates = materials
    // Analogue stock is evaluated by the normative analogue engine only. If
    // included here it would turn an intentional NO_MATCH into a direct match.
    .filter((material) => !material.fixtureTags?.includes("case:analogue"))
    .map((material) => scoreMaterial(position, material))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return (left.material?.materialCode ?? "").localeCompare(right.material?.materialCode ?? "", "ru");
    });

  const best = candidates[0];
  if (!best || best.score < 80) {
    return {
      score: best?.score ?? 0,
      category: "NO_MATCH",
      material: null,
      matched: best?.matched ?? [],
      differences: best?.differences ?? ["Кандидаты не найдены"],
      requiresHumanReview: false,
    };
  }
  return best;
}

function dimensionEqual(left: unknown, right: unknown): boolean {
  if (typeof left === "number" && typeof right === "number") {
    return Math.abs(left - right) <= 0.0001;
  }
  return normalizeText(String(left)) === normalizeText(String(right));
}

function numericCloseness(left: unknown, right: unknown): number {
  if (typeof left !== "number" || typeof right !== "number" || left === 0) return 0;
  const relativeDifference = Math.abs(left - right) / Math.abs(left);
  if (relativeDifference <= 0.01) return 0.9;
  if (relativeDifference <= 0.05) return 0.6;
  if (relativeDifference <= 0.1) return 0.25;
  return 0;
}
