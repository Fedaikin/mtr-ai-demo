import {
  normalizeCode,
  normalizeText,
  normalizeUnit,
  tokenSimilarity,
  tokenize,
} from "@/domain/normalize";

describe("normalize", () => {
  it("normalizes Russian and English material names to the same tokens", () => {
    const russian = tokenize("Труба стальная DN 50");
    const english = tokenize("Steel pipe DN50", "стальная");

    expect([...russian].every((token) => english.has(token))).toBe(true);
    expect(tokenSimilarity(russian, english)).toBeGreaterThanOrEqual(0.8);
  });

  it("normalizes Cyrillic engineering abbreviations and units", () => {
    expect(normalizeText("Труба ДУ50, РУ16")).toBe("труба dn 50 pn 16");
    expect(normalizeUnit("шт")).toBe("EA");
    expect(normalizeUnit("м")).toBe("M");
  });

  it("normalizes multiplication signs and spacing deterministically", () => {
    expect(normalizeText("Переход DN 80×50")).toBe("переход dn 80 x 50");
    expect(normalizeText("Eccentric reducer DN80*50")).toBe(
      "eccentric reducer dn 80 x 50",
    );
  });

  it("normalizes legacy identifiers independently of separators and case", () => {
    expect(normalizeCode("legacy-demo-p-001")).toBe("LEGACYDEMOP001");
    expect(normalizeCode("LEGACY_DEMO/P 001")).toBe("LEGACYDEMOP001");
    expect(normalizeCode()).toBe("");
  });

  it("returns zero similarity when either side has no searchable tokens", () => {
    expect(tokenSimilarity(new Set(), tokenize("насос"))).toBe(0);
    expect(tokenSimilarity(tokenize("pump"), new Set())).toBe(0);
  });
});
