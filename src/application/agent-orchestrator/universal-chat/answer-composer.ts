import type {
  UniversalAgentAnswer,
  UniversalClarification,
} from "@/domain/agent/universal-chat/answer";

export function composeUniversalChatResult(
  result: UniversalAgentAnswer | UniversalClarification,
): string {
  if ("kind" in result) {
    const candidates = result.candidates
      .map((candidate, index) => `${index + 1}. ${candidate.name} (${candidate.code})`)
      .join("\n");
    return candidates ? `${result.question}\n\n${candidates}` : result.question;
  }
  const sections: string[] = [result.summary];
  if (result.facts.length) {
    sections.push([
      "Итог",
      ...result.facts.map((item) =>
        `- ${item.label}: ${item.value}${item.unit ? ` ${item.unit}` : ""}`),
    ].join("\n"));
  }
  for (const table of result.tables.slice(0, 2)) {
    const rows = table.rows.slice(0, 12).map((row) =>
      `- ${table.columns.map((column) => `${column}: ${String(row[column] ?? "—")}`).join(" · ")}`,
    );
    sections.push([table.title, ...rows, ...(table.totalRows > rows.length ? [`- Показано ${rows.length} из ${table.totalRows}.`] : [])].join("\n"));
  }
  if (result.risks.length) {
    sections.push(["Риски", ...result.risks.slice(0, 8).map((risk) => `- ${risk.title}: ${risk.explanation}`)].join("\n"));
  }
  if (result.compatibility.length) {
    sections.push([
      "Варианты замены",
      ...result.compatibility.slice(0, 8).map((item) =>
        `- ${item.sourceMaterialCode} → ${item.candidateMaterialCode}: ${item.technicalCompatibilityPercent ?? "недостаточно данных"}% · покрытие ${item.quantityCoveragePercent}% · ${compatibilityVerdict(item.verdict)}`),
    ].join("\n"));
  }
  if (result.recommendations.length) {
    sections.push(["Рекомендации", ...result.recommendations.slice(0, 8).map((item) => `- ${item.title}: ${item.explanation} Остаточный риск: ${item.residualRisk}`)].join("\n"));
  }
  if (result.missingData.length) {
    sections.push(["Ограничения", ...result.missingData.map((item) => `- ${item.message} ${item.impact}`)].join("\n"));
  }
  if (result.citations.length) {
    sections.push(["Источники", ...result.citations.slice(0, 12).map((citation) =>
      `- ${citation.label} · ${citation.versionOrSnapshot}`)].join("\n"));
  }
  return sections.join("\n\n");
}

function compatibilityVerdict(value: UniversalAgentAnswer["compatibility"][number]["verdict"]): string {
  return {
    EXACT: "точное соответствие",
    COMPATIBLE: "совместимо",
    CONDITIONAL: "условно совместимо, требуется эксперт",
    ENGINEERING_REVIEW: "только инженерная проверка",
    NOT_RECOMMENDED: "не рекомендуется",
    PROHIBITED: "запрещено",
    INSUFFICIENT_DATA: "недостаточно данных",
  }[value];
}
