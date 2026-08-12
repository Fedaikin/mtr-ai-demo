const CYRILLIC_LATIN_EQUIVALENTS: Record<string, string> = {
  ду: "dn",
  dy: "dn",
  ру: "pn",
  pipe: "труба",
  elbow: "отвод",
  flange: "фланец",
  valve: "клапан",
  gasket: "прокладка",
  cable: "кабель",
  pump: "насос",
  motor: "электродвигатель",
  gauge: "манометр",
  pcs: "ea",
  шт: "ea",
  м: "m",
};

export function normalizeText(value: string): string {
  let normalized = value
    .toLocaleLowerCase("ru-RU")
    .normalize("NFKC")
    // Normalize only the dimension separator (100×50 / 3х2.5). Replacing all
    // Cyrillic «х» would corrupt ordinary words such as «переход».
    .replace(/(?<=\d)\s*[×х*]\s*(?=\d)/g, "x")
    .replace(/[°º]/g, " deg ")
    .replace(/[/_,;:()\[\]{}]+/g, " ")
    .replace(/([a-zа-я])([0-9])/gi, "$1 $2")
    .replace(/([0-9])([a-zа-я])/gi, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  // JavaScript's `\b` is ASCII-centric even with the Unicode flag, so it does
  // not recognize boundaries around Cyrillic words such as «ДУ» and «шт».
  // The tokenizer above already separates letter/number pairs, therefore an
  // exact token map is both deterministic and safe for RU/EN abbreviations.
  normalized = normalized
    .split(" ")
    .map((token) => CYRILLIC_LATIN_EQUIVALENTS[token] ?? token)
    .join(" ");

  return normalized.replace(/\s+/g, " ").trim();
}

export function tokenize(...values: Array<string | undefined>): Set<string> {
  return new Set(
    values
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => normalizeText(value).split(" "))
      .filter((token) => token.length > 1),
  );
}

export function tokenSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

export function normalizeUnit(unit: string): string {
  const normalized = normalizeText(unit);
  if (["ea", "piece", "pieces"].includes(normalized)) return "EA";
  if (["m", "meter", "metre"].includes(normalized)) return "M";
  if (["kg", "кг"].includes(normalized)) return "KG";
  return normalized.toUpperCase();
}

export function normalizeCode(code?: string): string {
  return (code ?? "").toUpperCase().replace(/[^A-ZА-Я0-9]/g, "");
}
