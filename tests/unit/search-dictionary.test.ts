import {
  resolveDictionaryKeys,
  tokenizeWithDictionary,
} from "@/domain/search-dictionary";

const dictionary = [
  { key: "PUMP", values: ["насос", "pump", "перекачивающий модуль"], active: true },
  { key: "PIPE", values: ["труба", "pipe"], active: false },
];

describe("active search dictionary", () => {
  it("resolves a configured multi-word synonym to its canonical concept", () => {
    expect(resolveDictionaryKeys("Нужен перекачивающий модуль", dictionary)).toEqual([
      "PUMP",
    ]);
  });

  it("does not use disabled dictionary records", () => {
    expect(resolveDictionaryKeys("Нужна труба", dictionary)).toEqual([]);
  });

  it("adds canonical and bilingual synonym tokens deterministically", () => {
    const tokens = tokenizeWithDictionary(["насос"], dictionary);

    expect(tokens).toEqual(
      new Set(["насос", "перекачивающий", "модуль"]),
    );
  });
});
