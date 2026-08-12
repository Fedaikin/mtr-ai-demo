import "server-only";

import { createHash } from "node:crypto";
import { extname } from "node:path";

const MAX_TEXT_LENGTH = 100_000;
const MAX_ROWS = 500;
const ALLOWED_EXTENSIONS = new Set([".csv", ".xlsx", ".xls", ".txt", ".pdf", ".docx", ".png", ".jpg", ".jpeg", ".tiff"]);
const ALLOWED_MIME_TYPES: Record<string, ReadonlySet<string>> = {
  ".csv": new Set(["text/csv", "application/csv", "application/vnd.ms-excel"]),
  ".txt": new Set(["text/plain"]),
  ".xlsx": new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]),
  ".xls": new Set(["application/vnd.ms-excel"]),
  ".pdf": new Set(["application/pdf"]),
  ".docx": new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
  ".png": new Set(["image/png"]),
  ".jpg": new Set(["image/jpeg"]),
  ".jpeg": new Set(["image/jpeg"]),
  ".tiff": new Set(["image/tiff"]),
};

export interface ParsedUpload {
  extension: string;
  checksumSha256: string;
  parseStatus: "PARSED" | "REVIEW_REQUIRED";
  normalizedData: Record<string, unknown>;
}

export async function parseUploadedFile(name: string, data: Uint8Array): Promise<ParsedUpload> {
  const extension = extname(name).toLocaleLowerCase("en-US");
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new UploadParseError("UNSUPPORTED_FILE_TYPE", "Поддерживаются CSV, XLS/XLSX, TXT, PDF, DOCX и демонстрационные изображения");
  assertFileSignature(extension, data);
  const checksumSha256 = createHash("sha256").update(data).digest("hex");

  if (extension === ".csv") return parsed(extension, checksumSha256, parseCsv(new TextDecoder("utf-8", { fatal: false }).decode(data)));
  if (extension === ".txt") {
    const text = sanitizeExtractedText(new TextDecoder("utf-8", { fatal: false }).decode(data));
    return documentResult(extension, checksumSha256, documentData("TEXT", text, []));
  }
  if (extension === ".xlsx" || extension === ".xls") return parsed(extension, checksumSha256, await parseWorkbook(data));
  if (extension === ".docx") {
    return documentResult(extension, checksumSha256, await parseDocx(data));
  }
  if (extension === ".pdf") {
    return documentResult(extension, checksumSha256, await parsePdf(data));
  }

  const knownDemo = DEMO_OCR_BY_HASH[checksumSha256];
  if (knownDemo) return parsed(extension, checksumSha256, knownDemo);
  return reviewRequired(extension, checksumSha256, {
    kind: "IMAGE",
    text: "",
    warnings: ["Хэш изображения отсутствует в demo-наборе. Требуется ручная проверка или внешний OCR-провайдер."],
  }, "IMAGE_HASH_NOT_IN_DEMO_SET");
}

export function validateUploadMime(name: string, mimeType: string): void {
  const extension = extname(name).toLocaleLowerCase("en-US");
  const allowed = ALLOWED_MIME_TYPES[extension];
  if (!allowed) {
    throw new UploadParseError("UNSUPPORTED_FILE_TYPE", "Расширение файла не поддерживается");
  }
  const normalized = mimeType.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US");
  if (normalized && normalized !== "application/octet-stream" && !allowed.has(normalized)) {
    throw new UploadParseError("FILE_MIME_MISMATCH", "MIME-тип файла не соответствует его расширению");
  }
}

function parsed(extension: string, checksumSha256: string, data: Record<string, unknown>): ParsedUpload {
  return { extension, checksumSha256, parseStatus: "PARSED", normalizedData: { ...data, isSyntheticDemo: true } };
}

function documentResult(
  extension: string,
  checksumSha256: string,
  data: Record<string, unknown>,
): ParsedUpload {
  const rows = data.rows;
  const rejectedPositionRecordCount = typeof data.rejectedPositionRecordCount === "number"
    ? data.rejectedPositionRecordCount
    : 0;
  if (Array.isArray(rows) && rows.length > 0 && rejectedPositionRecordCount === 0) {
    return parsed(extension, checksumSha256, data);
  }
  if (Array.isArray(rows) && rows.length > 0) {
    return reviewRequired(
      extension,
      checksumSha256,
      data,
      "POSITION_ROWS_PARTIALLY_REJECTED",
    );
  }
  const text = typeof data.text === "string" ? data.text : "";
  return reviewRequired(
    extension,
    checksumSha256,
    data,
    text ? "POSITION_STRUCTURE_NOT_RECOGNIZED" : "TEXT_LAYER_NOT_FOUND",
  );
}

function reviewRequired(
  extension: string,
  checksumSha256: string,
  data: Record<string, unknown>,
  reason: string,
): ParsedUpload {
  const warning = reason === "TEXT_LAYER_NOT_FOUND"
    ? "Текстовый слой не найден; требуется demo OCR или ручная проверка."
    : reason === "POSITION_ROWS_PARTIALLY_REJECTED"
      ? "Часть строк позиционного формата отклонена; требуется ручная проверка."
    : reason === "POSITION_STRUCTURE_NOT_RECOGNIZED"
      ? "Структурированные позиции МТР не распознаны; требуется ручная проверка."
      : "Хэш изображения отсутствует в demo-наборе. Требуется ручная проверка или внешний OCR-провайдер.";
  const suppliedWarnings = Array.isArray(data.warnings)
    ? data.warnings.filter((value): value is string => typeof value === "string")
    : [];
  const warnings = [...new Set([...suppliedWarnings, warning])];
  return {
    extension,
    checksumSha256,
    parseStatus: "REVIEW_REQUIRED",
    normalizedData: {
      ...data,
      warnings,
      review: { status: "REVIEW_REQUIRED", source: "DEMO_OCR", reason },
      isSyntheticDemo: true,
    },
  };
}

function parseCsv(text: string): Record<string, unknown> {
  const clean = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(clean);
  const rows = parseDelimited(clean, delimiter).slice(0, MAX_ROWS + 1);
  const headers = (rows.shift() ?? []).map((value, index) => sanitizeCell(value) || `column_${index + 1}`);
  const records = rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, sanitizeCell(row[index] ?? "")])));
  return {
    kind: "TABULAR",
    delimiter,
    headers,
    rows: records,
    rowCount: records.length,
    warnings: records.length >= MAX_ROWS ? [`Импорт ограничен первыми ${MAX_ROWS} строками.`] : [],
  };
}

async function parseWorkbook(data: Uint8Array): Promise<Record<string, unknown>> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(data, { type: "array", dense: true, sheetRows: MAX_ROWS + 1, cellFormula: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new UploadParseError("EMPTY_WORKBOOK", "В книге нет листов");
  const sheet = workbook.Sheets[firstSheetName];
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false }).slice(0, MAX_ROWS);
  const headers = records[0] ? Object.keys(records[0]) : [];
  return { kind: "TABULAR", sheetName: firstSheetName, headers, rows: records, rowCount: records.length, warnings: records.length >= MAX_ROWS ? [`Импорт ограничен первыми ${MAX_ROWS} строками.`] : [] };
}

async function parseDocx(data: Uint8Array): Promise<Record<string, unknown>> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: Buffer.from(data) });
  const text = sanitizeExtractedText(result.value);
  return documentData(
    "DOCUMENT_TEXT",
    text,
    result.messages.map((message) => message.message).slice(0, 20),
  );
}

async function parsePdf(data: Uint8Array): Promise<Record<string, unknown>> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const document = await getDocumentProxy(data);
  if (document.numPages > 100) throw new UploadParseError("PDF_PAGE_LIMIT", "PDF содержит более 100 страниц");
  const result = await extractText(document, { mergePages: true });
  const text = sanitizeExtractedText(String(result.text ?? ""));
  return {
    ...documentData(
      "DOCUMENT_TEXT",
      text,
      text ? [] : ["Текстовый слой не найден; требуется demo OCR или ручная проверка."],
    ),
    pageCount: result.totalPages,
  };
}

function documentData(
  kind: "TEXT" | "DOCUMENT_TEXT",
  text: string,
  warnings: string[],
): Record<string, unknown> {
  const extraction = positionRowsFromText(text);
  const positionalWarnings = extraction.rejectedPositionRecordCount > 0
    ? [`Отклонено записей позиционного формата: ${extraction.rejectedPositionRecordCount}. Требуется ручная проверка.`]
    : [];
  return {
    kind,
    text,
    characterCount: text.length,
    rows: extraction.rows,
    rowCount: extraction.rows.length,
    rejectedPositionRecordCount: extraction.rejectedPositionRecordCount,
    warnings: [...warnings, ...positionalWarnings],
  };
}

interface PositionRowExtraction {
  rows: Record<string, string>[];
  rejectedPositionRecordCount: number;
}

function positionRowsFromText(text: string): PositionRowExtraction {
  const labeled = labeledPositionRowsFromText(text);
  const positional = positionalPositionRowsFromText(text);
  if (labeled.recognizedRecordCount === 0) return positional;
  return {
    rows: labeled.rows,
    rejectedPositionRecordCount:
      labeled.rejectedPositionRecordCount +
      positional.rejectedPositionRecordCount +
      positional.rows.length,
  };
}

interface LabeledPositionRowExtraction extends PositionRowExtraction {
  recognizedRecordCount: number;
}

function labeledPositionRowsFromText(text: string): LabeledPositionRowExtraction {
  const rows: Record<string, string>[] = [];
  let current: Record<string, string> = {};
  let rejectedPositionRecordCount = 0;
  let recognizedRecordCount = 0;

  const finishCurrent = () => {
    if (Object.keys(current).length === 0) return;
    recognizedRecordCount += 1;
    if (hasRequiredPositionFields(current)) rows.push(current);
    else rejectedPositionRecordCount += 1;
    current = {};
  };

  for (const rawLine of text.split("\n")) {
    const match = rawLine.trim().match(/^([^:]{1,120}):\s*(.+)$/u);
    if (!match) continue;
    const field = DOCUMENT_POSITION_FIELDS[canonicalDocumentField(match[1] ?? "")];
    if (!field) continue;
    if (field === "internalCode" && current.internalCode) finishCurrent();
    current[field] = sanitizeCell(match[2] ?? "");
  }
  finishCurrent();
  return {
    rows: rows.slice(0, MAX_ROWS),
    rejectedPositionRecordCount,
    recognizedRecordCount,
  };
}

function positionalPositionRowsFromText(text: string): PositionRowExtraction {
  const rows: Record<string, string>[] = [];
  let rejectedPositionRecordCount = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const hasSemicolon = line.includes(";");
    const hasPipe = line.includes("|");
    if (!line || (!hasSemicolon && !hasPipe)) continue;
    if (hasSemicolon === hasPipe) {
      rejectedPositionRecordCount += 1;
      continue;
    }

    const delimiter = hasSemicolon ? ";" : "|";
    let cells = line.split(delimiter).map((value) => sanitizeCell(value));
    if (delimiter === "|") {
      if (cells[0] === "") cells = cells.slice(1);
      if (cells.at(-1) === "") cells = cells.slice(0, -1);
    }
    if (cells.length !== 4) {
      rejectedPositionRecordCount += 1;
      continue;
    }

    const [internalCode = "", nameRu = "", requiredQuantity = "", unit = ""] = cells;
    if (!isPositionCode(internalCode) || !nameRu || nameRu.length > 500) {
      rejectedPositionRecordCount += 1;
      continue;
    }
    if (!isPositiveQuantity(requiredQuantity) || !isPositionUnit(unit)) {
      rejectedPositionRecordCount += 1;
      continue;
    }
    rows.push({ internalCode, nameRu, requiredQuantity, unit });
    if (rows.length >= MAX_ROWS) break;
  }
  return { rows, rejectedPositionRecordCount };
}

function isPositionCode(value: string): boolean {
  return value.length <= 160 && /^[\p{L}\p{N}][\p{L}\p{N}._/-]*$/u.test(value);
}

function isPositiveQuantity(value: string): boolean {
  const normalized = value.replace(/[\s\u00a0]/gu, "").replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/u.test(normalized)) return false;
  const quantity = Number(normalized);
  return Number.isFinite(quantity) && quantity > 0 && quantity <= 1_000_000_000_000;
}

function isPositionUnit(value: string): boolean {
  return value.length <= 30 && /^[\p{L}\p{N}][\p{L}\p{N}\s./%°²³^*-]*$/u.test(value);
}

function hasRequiredPositionFields(row: Record<string, string>): boolean {
  return ["internalCode", "nameRu", "requiredQuantity", "unit"].every((field) => Boolean(row[field]));
}

function canonicalDocumentField(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}]+/gu, "");
}

const DOCUMENT_POSITION_FIELDS: Record<string, string> = {
  internalcode: "internalCode",
  code: "internalCode",
  код: "internalCode",
  кодпозиции: "internalCode",
  кодappius: "internalCode",
  nameru: "nameRu",
  name: "nameRu",
  наименование: "nameRu",
  название: "nameRu",
  позиция: "nameRu",
  equipmenttype: "equipmentType",
  типоборудования: "equipmentType",
  тип: "equipmentType",
  requiredquantity: "requiredQuantity",
  требуемоеколичество: "requiredQuantity",
  количество: "requiredQuantity",
  потребность: "requiredQuantity",
  unit: "unit",
  uom: "unit",
  единица: "unit",
  единицаизмерения: "unit",
  едизм: "unit",
  standard: "standard",
  стандарт: "standard",
  норматив: "standard",
  materialgrade: "materialGrade",
  маркаматериала: "materialGrade",
  dn: "DN",
};

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    const next = text[index + 1];
    if (character === '"') {
      if (quoted && next === '"') { cell += '"'; index += 1; } else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(cell); cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) break;
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); if (row.some((value) => value.trim())) rows.push(row); }
  return rows;
}

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/, 3).join("\n");
  return [";", ",", "\t"].map((delimiter) => ({ delimiter, count: sample.split(delimiter).length - 1 })).sort((a, b) => b.count - a.count)[0]?.delimiter ?? ";";
}

function sanitizeExtractedText(value: string): string {
  return value.replaceAll("\u0000", "").replace(/\r\n?/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim().slice(0, MAX_TEXT_LENGTH);
}

function sanitizeCell(value: string): string {
  const clean = value.replaceAll("\u0000", "").trim().slice(0, 2_000);
  return /^[=+@]/.test(clean) || /^-\D/.test(clean) ? `'${clean}` : clean;
}

function assertFileSignature(extension: string, data: Uint8Array): void {
  const startsWith = (...bytes: number[]) => bytes.every((byte, index) => data[index] === byte);
  const valid =
    extension === ".csv" ||
    extension === ".txt" ||
    ((extension === ".xlsx" || extension === ".docx") && startsWith(0x50, 0x4b, 0x03, 0x04)) ||
    (extension === ".xls" && startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) ||
    (extension === ".pdf" && startsWith(0x25, 0x50, 0x44, 0x46, 0x2d)) ||
    (extension === ".png" && startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) ||
    ((extension === ".jpg" || extension === ".jpeg") && startsWith(0xff, 0xd8, 0xff)) ||
    (extension === ".tiff" &&
      (startsWith(0x49, 0x49, 0x2a, 0x00) || startsWith(0x4d, 0x4d, 0x00, 0x2a)));
  if (!valid) {
    throw new UploadParseError("FILE_SIGNATURE_MISMATCH", "Содержимое файла не соответствует его расширению");
  }
}

const DEMO_OCR_TEXT = [
  "Синтетическая позиция МТР",
  "internalCode: OCR-DEMO-PNG-001",
  "nameRu: Труба демонстрационная из OCR",
  "equipmentType: PIPE",
  "requiredQuantity: 2",
  "unit: M",
].join("\n");

const DEMO_OCR_POSITION = {
  kind: "OCR_DEMO",
  text: DEMO_OCR_TEXT,
  characterCount: DEMO_OCR_TEXT.length,
  rows: [{
    internalCode: "OCR-DEMO-PNG-001",
    nameRu: "Труба демонстрационная из OCR",
    equipmentType: "PIPE",
    requiredQuantity: "2",
    unit: "M",
  }],
  rowCount: 1,
  warnings: ["Результат получен детерминированным demo OCR по хэшу файла."],
};

const DEMO_OCR_BY_HASH: Record<string, Record<string, unknown>> = {
  // Minimal synthetic PNG-signature fixture used only to prove the hash-bound
  // OCR adapter contract. Unknown image hashes always require manual review.
  "4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6": DEMO_OCR_POSITION,
  // Valid 1x1 synthetic PNG used by acceptance tests and the demo scan fixture.
  "7ffa93f63abeed157b9d4eef41847fb041fe5aaad45b923fff4f0d5334cac098": DEMO_OCR_POSITION,
};

export class UploadParseError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "UploadParseError"; }
}
