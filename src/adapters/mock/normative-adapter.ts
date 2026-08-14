import "server-only";

import {
  getRepository,
  type IntegrationStateRecord,
  type MtrRepository,
} from "@/adapters/persistence/repository";
import type {
  AnalogueRule,
  Position,
  ResponsibilityRule,
  RuleRetrievalEvidence,
} from "@/domain/models";
import { normalizeText, tokenSimilarity } from "@/domain/normalize";
import { isResponsibilityRuleApplicable } from "@/domain/responsibility";
import {
  resolveDictionaryKeys,
  tokenizeWithDictionary,
  type SearchDictionaryEntry,
} from "@/domain/search-dictionary";
import type { NormativePort } from "@/ports";

type NormativeRepository = Pick<
  MtrRepository,
  | "getIntegrationState"
  | "getIntegrationStateInSourceScopes"
  | "listAnalogueRules"
  | "listAnalogueRulesInSourceScopes"
  | "listDictionaries"
  | "listNormativeChunks"
  | "listNormativeChunksInSourceScopes"
  | "listResponsibilityRules"
  | "listResponsibilityRulesInSourceScopes"
>;

export interface TrustedNormativeScope {
  readonly subjectId: string;
  readonly sourceScopeIds: readonly string[];
}

export interface NormativeChunkRecord {
  id: string;
  userId: string;
  clauseId: string;
  title: string;
  text: string;
  language: string;
  equipmentTypes: string[];
  applicability: Record<string, unknown>;
  allowedDeviations: Record<string, unknown>;
  accessAttributes: Record<string, unknown>;
  isSyntheticDemo: boolean;
  documentId: string;
  documentVersion: string;
  sourceScopeId?: string | null;
}

export interface NormativeSearchHit {
  citation: {
    documentId: string;
    version: string;
    clauseId: string;
    isSyntheticDemo: true;
  };
  evidence: RuleRetrievalEvidence;
}

export type NormativeSearchKind = "RESPONSIBILITY" | "ANALOGUE";

export class NormativeMockError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly safeMessage: string,
  ) {
    super(safeMessage);
    this.name = "NormativeMockError";
  }
}

/**
 * Versioned deterministic RAG adapter. It combines lexical overlap, a
 * dictionary-backed semantic-like signal and structured metadata relevance.
 * No embedding service is required for the demo fallback.
 */
export class NormativeMockAdapter implements NormativePort {
  constructor(private readonly repository: NormativeRepository) {}

  async searchResponsibilityRules(
    position: Position,
    userId: string,
  ): Promise<ResponsibilityRule[]> {
    return (await this.searchResponsibilityRulesBatch([position], userId)).get(position.id) ?? [];
  }

  async searchResponsibilityRulesBatch(
    positions: Position[],
    userId: string,
  ): Promise<Map<string, ResponsibilityRule[]>> {
    await this.assertReadable(userId);
    const [rules, chunks, dictionaries] = await Promise.all([
      this.repository.listResponsibilityRules(userId),
      this.repository.listNormativeChunks(userId, { limit: 500 }),
      this.repository.listDictionaries(userId, "MTR_SEARCH_SYNONYMS"),
    ]);
    return new Map(positions.map((position) => {
      const applicableRules = rules.filter((rule) =>
        isResponsibilityRuleApplicable(position, rule),
      );
      return [
        position.id,
        attachEvidence(
          applicableRules,
          rankNormativeChunks(
            position,
            chunks as NormativeChunkRecord[],
            dictionaries,
            "RESPONSIBILITY",
            new Set(applicableRules.map(ruleKey)),
          ),
        ),
      ];
    }));
  }

  async getResponsibilityRuleCorpusInScope(
    scope: TrustedNormativeScope,
  ): Promise<ResponsibilityRule[]> {
    await this.assertReadableInScope(scope);
    return this.repository.listResponsibilityRulesInSourceScopes(scope.sourceScopeIds);
  }

  async searchResponsibilityRulesBatchInScope(
    positions: Position[],
    scope: TrustedNormativeScope,
  ): Promise<Map<string, ResponsibilityRule[]>> {
    await this.assertReadableInScope(scope);
    const [rules, chunks] = await Promise.all([
      this.repository.listResponsibilityRulesInSourceScopes(scope.sourceScopeIds),
      this.repository.listNormativeChunksInSourceScopes(scope.sourceScopeIds, { limit: 500 }),
    ]);
    const allowedSourceScopes = new Set(scope.sourceScopeIds);
    return new Map(positions.map((position) => {
      const applicableRules = rules.filter((rule) => isResponsibilityRuleApplicable(position, rule));
      return [
        position.id,
        attachEvidence(
          applicableRules,
          rankNormativeChunks(
            position,
            chunks as NormativeChunkRecord[],
            [],
            "RESPONSIBILITY",
            new Set(applicableRules.map(ruleKey)),
            allowedSourceScopes,
          ),
        ),
      ];
    }));
  }

  async searchAnalogueRules(position: Position, userId: string): Promise<AnalogueRule[]> {
    return (await this.searchAnalogueRulesBatch([position], userId)).get(position.id) ?? [];
  }

  async searchAnalogueRulesBatch(
    positions: Position[],
    userId: string,
  ): Promise<Map<string, AnalogueRule[]>> {
    await this.assertReadable(userId);
    const [rules, chunks, dictionaries] = await Promise.all([
      this.repository.listAnalogueRules(userId),
      this.repository.listNormativeChunks(userId, { limit: 500 }),
      this.repository.listDictionaries(userId, "MTR_SEARCH_SYNONYMS"),
    ]);
    return new Map(positions.map((position) => {
      const applicableRules = rules.filter(
        (rule) =>
          rule.equipmentTypes.includes(position.equipmentType) ||
          rule.equipmentTypes.includes("*"),
      );
      return [
        position.id,
        attachEvidence(
          applicableRules,
          rankNormativeChunks(
            position,
            chunks as NormativeChunkRecord[],
            dictionaries,
            "ANALOGUE",
            new Set(applicableRules.map(ruleKey)),
          ),
        ),
      ];
    }));
  }

  async searchAnalogueRulesBatchInScope(
    positions: Position[],
    scope: TrustedNormativeScope,
  ): Promise<Map<string, AnalogueRule[]>> {
    await this.assertReadableInScope(scope);
    const [rules, chunks] = await Promise.all([
      this.repository.listAnalogueRulesInSourceScopes(scope.sourceScopeIds),
      this.repository.listNormativeChunksInSourceScopes(scope.sourceScopeIds, { limit: 500 }),
    ]);
    const allowedSourceScopes = new Set(scope.sourceScopeIds);
    return new Map(positions.map((position) => {
      const applicableRules = rules.filter((rule) =>
        rule.equipmentTypes.includes(position.equipmentType) || rule.equipmentTypes.includes("*"));
      return [
        position.id,
        attachEvidence(
          applicableRules,
          rankNormativeChunks(
            position,
            chunks as NormativeChunkRecord[],
            [],
            "ANALOGUE",
            new Set(applicableRules.map(ruleKey)),
            allowedSourceScopes,
          ),
        ),
      ];
    }));
  }

  private async assertReadable(userId: string): Promise<IntegrationStateRecord> {
    const state = await this.repository.getIntegrationState(userId, "RAG");
    if (!state) {
      throw new NormativeMockError(
        503,
        "RAG_STATE_NOT_CONFIGURED",
        "Состояние нормативного поиска не настроено.",
      );
    }
    if (state.state === "SLOW") await controlledDelay(state.delayMs);
    if (state.state === "AVAILABLE" || state.state === "SLOW") return state;

    const status = state.state === "RATE_LIMITED" ? 429 : 503;
    throw new NormativeMockError(
      status,
      `RAG_${state.state}`,
      state.safeMessage ?? safeStateMessage(state.state),
    );
  }

  private async assertReadableInScope(
    scope: TrustedNormativeScope,
  ): Promise<IntegrationStateRecord> {
    const state = await this.repository.getIntegrationStateInSourceScopes(
      scope.sourceScopeIds,
      "RAG",
    );
    if (!state) {
      throw new NormativeMockError(503, "RAG_STATE_NOT_CONFIGURED", "Состояние нормативного поиска не настроено.");
    }
    if (state.state === "SLOW") await controlledDelay(state.delayMs);
    if (state.state === "AVAILABLE" || state.state === "SLOW") return state;
    throw new NormativeMockError(
      state.state === "RATE_LIMITED" ? 429 : 503,
      `RAG_${state.state}`,
      state.safeMessage ?? safeStateMessage(state.state),
    );
  }
}

export async function createNormativeMockAdapter(): Promise<NormativeMockAdapter> {
  return new NormativeMockAdapter(await getRepository());
}

export function rankNormativeChunks(
  position: Position,
  chunks: NormativeChunkRecord[],
  dictionaries: SearchDictionaryEntry[],
  kind: NormativeSearchKind,
  allowedRuleKeys?: Set<string>,
  allowedSourceScopes?: ReadonlySet<string>,
): NormativeSearchHit[] {
  const queryValues = positionSearchValues(position);
  const queryTokens = tokenizeWithDictionary(queryValues, dictionaries);
  const queryConcepts = new Set(
    queryValues.flatMap((value) => resolveDictionaryKeys(value, dictionaries)),
  );

  const ranked = chunks.flatMap((chunk): NormativeSearchHit[] => {
    const scopeAuthorized = chunk.sourceScopeId !== null && chunk.sourceScopeId !== undefined &&
      allowedSourceScopes?.has(chunk.sourceScopeId);
    if (!chunk.isSyntheticDemo || !(scopeAuthorized || hasChunkAccess(chunk, position.userId))) return [];
    const key = citationKey(chunk.documentId, chunk.documentVersion, chunk.clauseId);
    if (allowedRuleKeys && !allowedRuleKeys.has(key)) return [];
    if (!chunkMatchesKind(chunk, kind)) return [];

    const metadata = metadataRelevance(position, chunk);
    if (metadata.score <= 0) return [];
    const chunkValues = [
      chunk.title,
      chunk.text,
      ...chunk.equipmentTypes,
      ...flattenMetadata(chunk.applicability),
      ...flattenMetadata(chunk.allowedDeviations),
    ];
    const chunkTokens = tokenizeWithDictionary(chunkValues, dictionaries);
    const lexicalScore = tokenSimilarity(queryTokens, chunkTokens);
    const chunkConcepts = new Set(
      chunkValues.flatMap((value) => resolveDictionaryKeys(value, dictionaries)),
    );
    const semanticScore = deterministicSemanticScore(
      queryTokens,
      chunkTokens,
      queryConcepts,
      chunkConcepts,
    );
    const score = roundScore(
      metadata.score * 0.55 + semanticScore * 0.3 + lexicalScore * 0.15,
    );

    return [
      {
        citation: {
          documentId: chunk.documentId,
          version: chunk.documentVersion,
          clauseId: chunk.clauseId,
          isSyntheticDemo: true,
        },
        evidence: {
          chunkId: chunk.id,
          language: chunk.language,
          score,
          lexicalScore: roundScore(lexicalScore),
          semanticScore: roundScore(semanticScore),
          metadataScore: roundScore(metadata.score),
          matchedAttributes: metadata.matchedAttributes,
        },
      },
    ];
  });

  const bestByClause = new Map<string, NormativeSearchHit>();
  for (const hit of ranked) {
    const key = citationKey(
      hit.citation.documentId,
      hit.citation.version,
      hit.citation.clauseId,
    );
    const current = bestByClause.get(key);
    if (!current || compareHits(hit, current) < 0) bestByClause.set(key, hit);
  }
  return [...bestByClause.values()].sort(compareHits);
}

function attachEvidence<T extends ResponsibilityRule | AnalogueRule>(
  rules: T[],
  hits: NormativeSearchHit[],
): T[] {
  const hitByRule = new Map(
    hits.map((hit) => [
      citationKey(hit.citation.documentId, hit.citation.version, hit.citation.clauseId),
      hit,
    ]),
  );
  return rules
    .flatMap((rule) => {
      const hit = hitByRule.get(ruleKey(rule));
      return hit ? [{ ...rule, retrievalEvidence: hit.evidence } as T] : [];
    })
    .sort((left, right) => {
      const score =
        (right.retrievalEvidence?.score ?? 0) - (left.retrievalEvidence?.score ?? 0);
      return score || ruleKey(left).localeCompare(ruleKey(right), "ru");
    });
}

function metadataRelevance(
  position: Position,
  chunk: NormativeChunkRecord,
): { score: number; matchedAttributes: string[] } {
  const matchedAttributes: string[] = [];
  let earned = 0;
  let possible = 1;
  if (chunk.equipmentTypes.includes(position.equipmentType)) {
    earned += 1;
    matchedAttributes.push("equipmentType");
  } else if (chunk.equipmentTypes.includes("*")) {
    earned += 0.35;
    matchedAttributes.push("equipmentType:wildcard");
  } else {
    return { score: 0, matchedAttributes: [] };
  }

  for (const [key, expected] of Object.entries(chunk.applicability)) {
    if (["scope", "responsibility", "requiresHumanReview", "reviewWhen"].includes(key)) {
      if (key === "reviewWhen" && applicabilityValue(position, key) === expected) {
        earned += 0.5;
        possible += 0.5;
        matchedAttributes.push(key);
      }
      continue;
    }
    possible += 0.5;
    if (metadataValueMatches(applicabilityValue(position, key), expected)) {
      earned += 0.5;
      matchedAttributes.push(key);
    }
  }
  return { score: possible === 0 ? 0 : earned / possible, matchedAttributes };
}

function applicabilityValue(position: Position, key: string): unknown {
  if (key === "pumpKind" && position.classification.classCode?.includes("METERING")) {
    return "METERING";
  }
  if (key === "motorKind" && isHazardousPosition(position)) {
    return "HAZARDOUS_AREA_DEMO";
  }
  if (key === "geometry") {
    const searchable = normalizeText([position.nameRu, position.nameEn, ...position.synonyms].join(" "));
    if (/(?:eccentric|эксцентр)/iu.test(searchable)) return "ECCENTRIC";
  }
  if (key === "requiredMaterialGroup") return position.materialGrade;
  if (key === "reviewWhen" && isHazardousPosition(position)) return "HAZARDOUS_AREA";
  if (key in position.classification) return position.classification[key];
  if (key in position.dimensions) return position.dimensions[key];
  if (key === "standard") return position.standard;
  if (key === "materialGrade") return position.materialGrade;
  return undefined;
}

function metadataValueMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return expected.some((value) => metadataValueMatches(actual, value));
  if (actual === undefined || actual === null) return false;
  if (typeof actual === "number" && typeof expected === "number") {
    return Math.abs(actual - expected) <= 0.0001;
  }
  const left = normalizeText(String(actual));
  const right = normalizeText(String(expected));
  if (left === right) return true;
  const leftTokens = new Set(left.split(" ").filter((token) => token.length > 2));
  const rightTokens = new Set(
    right
      .replace(/[-\s]+compatible\b/gu, "")
      .split(" ")
      .filter((token) => token.length > 2),
  );
  return rightTokens.size > 0 && [...rightTokens].every((token) => leftTokens.has(token));
}

function deterministicSemanticScore(
  queryTokens: Set<string>,
  chunkTokens: Set<string>,
  queryConcepts: Set<string>,
  chunkConcepts: Set<string>,
): number {
  const conceptUnion = new Set([...queryConcepts, ...chunkConcepts]);
  const conceptIntersection = [...queryConcepts].filter((value) => chunkConcepts.has(value)).length;
  const conceptScore = conceptUnion.size === 0 ? 0 : conceptIntersection / conceptUnion.size;
  const query = [...queryTokens].filter((token) => token.length >= 4);
  const chunks = [...chunkTokens].filter((token) => token.length >= 4);
  const softMatches = query.filter((left) =>
    chunks.some((right) => left === right || sameStem(left, right)),
  ).length;
  const softScore = query.length === 0 ? 0 : softMatches / query.length;
  return conceptUnion.size > 0 ? conceptScore * 0.7 + softScore * 0.3 : softScore;
}

function sameStem(left: string, right: string): boolean {
  const length = Math.min(left.length, right.length, 6);
  return length >= 4 && left.slice(0, length) === right.slice(0, length);
}

function positionSearchValues(position: Position): string[] {
  return [
    position.internalCode,
    position.nameRu,
    position.nameEn,
    ...position.synonyms,
    position.equipmentType,
    position.standard,
    position.materialGrade,
    ...Object.entries(position.classification).flatMap(([key, value]) => [key, value]),
    ...Object.entries(position.dimensions).flatMap(([key, value]) => [key, String(value)]),
  ].filter((value): value is string => Boolean(value));
}

function flattenMetadata(value: Record<string, unknown>): string[] {
  return Object.entries(value).flatMap(([key, item]) => [key, String(item)]);
}

function hasChunkAccess(chunk: NormativeChunkRecord, userId: string): boolean {
  const allowed = chunk.accessAttributes.allowedUserIds;
  if (Array.isArray(allowed) && !allowed.includes(userId)) return false;
  const level = chunk.accessAttributes.level;
  return level === undefined || level === "DEMO_USER";
}

function chunkMatchesKind(chunk: NormativeChunkRecord, kind: NormativeSearchKind): boolean {
  const isResponsibility =
    typeof chunk.applicability.responsibility === "string" ||
    chunk.documentId === "КТ-374-DEMO";
  return kind === "RESPONSIBILITY" ? isResponsibility : !isResponsibility;
}

function isHazardousPosition(position: Position): boolean {
  const searchable = normalizeText(
    [
      position.nameRu,
      position.nameEn,
      ...position.synonyms,
      position.classification.classCode,
      position.dimensions.protectionClass === undefined
        ? undefined
        : String(position.dimensions.protectionClass),
    ]
      .filter((value): value is string => Boolean(value))
      .join(" "),
  );
  return /(?:hazardous|explosion|взрыв|\bex\b)/iu.test(searchable);
}

function compareHits(left: NormativeSearchHit, right: NormativeSearchHit): number {
  const score = right.evidence.score - left.evidence.score;
  if (score !== 0) return score;
  if (left.evidence.language !== right.evidence.language) {
    if (left.evidence.language === "ru") return -1;
    if (right.evidence.language === "ru") return 1;
  }
  return left.evidence.chunkId.localeCompare(right.evidence.chunkId, "ru");
}

function ruleKey(rule: ResponsibilityRule | AnalogueRule): string {
  return citationKey(rule.documentId, rule.version, rule.clauseId);
}

function citationKey(documentId: string, version: string, clauseId: string): string {
  return `${documentId}:${version}:${clauseId}`;
}

function roundScore(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;
}

async function controlledDelay(delayMs: number): Promise<void> {
  const safeDelay = Math.max(0, Math.min(10_000, Math.trunc(delayMs)));
  if (safeDelay > 0) await new Promise<void>((resolve) => setTimeout(resolve, safeDelay));
}

function safeStateMessage(state: string): string {
  if (state === "RATE_LIMITED") return "Нормативный поиск временно ограничил частоту запросов.";
  if (state === "MALFORMED_RESPONSE") {
    return "Ответ нормативного поиска не прошёл проверку контракта.";
  }
  return "Нормативный поиск временно недоступен.";
}
