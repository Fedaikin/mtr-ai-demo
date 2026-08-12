import { normalizeText, tokenize } from "./normalize";

export interface SearchDictionaryEntry {
  key: string;
  values: string[];
  active?: boolean;
}

/**
 * Resolves user-facing synonyms to the stable canonical key configured by an
 * administrator.  Longest terms win so a phrase such as "pressure gauge" is
 * preferred over a shorter overlapping token.
 */
export function resolveDictionaryKeys(
  value: string,
  entries: SearchDictionaryEntry[],
): string[] {
  const haystack = normalizeDictionaryText(value);
  if (!haystack) return [];

  return [...entries]
    .filter((entry) => entry.active !== false)
    .flatMap((entry) => {
      const terms = [entry.key, ...entry.values]
        .map((term) => normalizeDictionaryText(term))
        .filter(Boolean)
        .sort((left, right) => right.length - left.length);
      return terms.some((term) => containsNormalizedTerm(haystack, term)) ? [entry.key] : [];
    })
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .sort((left, right) => left.localeCompare(right, "ru"));
}

/** Adds canonical concepts and configured synonyms without discarding source text. */
export function tokenizeWithDictionary(
  values: Array<string | undefined>,
  entries: SearchDictionaryEntry[],
): Set<string> {
  const source = values.filter((value): value is string => Boolean(value));
  const canonicalKeys = source.flatMap((value) => resolveDictionaryKeys(value, entries));
  const expansions = canonicalKeys.flatMap((key) => {
    const entry = entries.find((candidate) => candidate.active !== false && candidate.key === key);
    return entry ? [entry.key, ...entry.values] : [key];
  });
  return tokenize(...source, ...canonicalKeys, ...expansions);
}

export function dictionaryTermsForKey(
  key: string,
  entries: SearchDictionaryEntry[],
): string[] {
  const normalizedKey = normalizeText(key);
  const entry = entries.find(
    (candidate) =>
      candidate.active !== false && normalizeText(candidate.key) === normalizedKey,
  );
  return entry ? [entry.key, ...entry.values] : [key];
}

function containsNormalizedTerm(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const paddedHaystack = ` ${haystack} `;
  const paddedNeedle = ` ${needle} `;
  return paddedHaystack.includes(paddedNeedle);
}

function normalizeDictionaryText(value: string): string {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
