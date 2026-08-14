export interface ResolvableEntity {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly aliases: readonly string[];
}

export type EntityResolution<T extends ResolvableEntity> =
  | Readonly<{ kind: "RESOLVED"; entity: T; confidence: number; matchedBy: string }>
  | Readonly<{ kind: "AMBIGUOUS"; candidates: readonly Readonly<{ entity: T; confidence: number }>[] }>
  | Readonly<{ kind: "NOT_FOUND"; checkedCount: number }>;

export const ENTITY_RESOLVER_VERSION = "universal-entity-resolver-v1" as const;

export function resolveEntity<T extends ResolvableEntity>(
  rawQuery: string,
  entities: readonly T[],
): EntityResolution<T> {
  const query = normalizeSearchText(rawQuery);
  if (!query) return { kind: "NOT_FOUND", checkedCount: entities.length };

  const scored = entities
    .map((entity) => scoreEntity(query, entity))
    .filter((candidate) => candidate.confidence >= 0.55)
    .sort((left, right) =>
      right.confidence - left.confidence || left.entity.code.localeCompare(right.entity.code),
    );
  const best = scored[0];
  if (!best) return { kind: "NOT_FOUND", checkedCount: entities.length };

  const second = scored[1];
  if (
    second &&
    best.confidence < 0.96 &&
    best.confidence - second.confidence < 0.08
  ) {
    return { kind: "AMBIGUOUS", candidates: scored.slice(0, 5) };
  }
  if (best.confidence < 0.72) {
    return { kind: "AMBIGUOUS", candidates: scored.slice(0, 5) };
  }
  return {
    kind: "RESOLVED",
    entity: best.entity,
    confidence: best.confidence,
    matchedBy: best.matchedBy,
  };
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/[ё]/gu, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function scoreEntity<T extends ResolvableEntity>(
  query: string,
  entity: T,
): { entity: T; confidence: number; matchedBy: string } {
  const candidates = [entity.code, entity.name, ...entity.aliases]
    .map((value) => ({ raw: value, normalized: normalizeSearchText(value) }))
    .filter((value) => value.normalized.length > 0);
  let confidence = 0;
  let matchedBy = entity.code;
  for (const candidate of candidates) {
    const next = scoreText(query, candidate.normalized);
    if (next > confidence) {
      confidence = next;
      matchedBy = candidate.raw;
    }
  }
  return { entity, confidence: round(confidence), matchedBy };
}

function scoreText(query: string, candidate: string): number {
  if (candidate === query) return 1;
  if (candidate.startsWith(query) || query.startsWith(candidate)) return 0.96;
  if (candidate.includes(query) || query.includes(candidate)) return 0.9;
  const queryTokens = new Set(query.split(" "));
  const candidateTokens = new Set(candidate.split(" "));
  const intersection = [...queryTokens].filter((token) => candidateTokens.has(token)).length;
  const union = new Set([...queryTokens, ...candidateTokens]).size;
  const tokenScore = union === 0 ? 0 : intersection / union;
  const distance = levenshtein(query, candidate);
  const editScore = 1 - distance / Math.max(query.length, candidate.length, 1);
  return Math.max(tokenScore * 0.9, editScore * 0.88);
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
