import { rolloutUniversalAgentDataset } from "../src/adapters/persistence/bootstrap";
import { closeDatabase, getDatabaseKind } from "../src/adapters/persistence/db";

async function main(): Promise<void> {
  const result = await rolloutUniversalAgentDataset();
  const target = getDatabaseKind() === "postgres" ? "PostgreSQL" : "локальной PGlite";
  console.info(
    `Аддитивное обновление МТР-агента выполнено в ${target}: ` +
      `спецификаций ${result.baseCounts.specifications}, ` +
      `позиций ${result.baseCounts.canonicalPositions}, ` +
      `промптов ${result.baseCounts.prompts}, ` +
      `проектов ${result.universalCounts.businessProjects}, ` +
      `оперативных материалов ${result.universalCounts.operationalMaterialViews}.`,
  );
  console.info(
    `Изменения: portfolio=${result.portfolioAdded}, prompts_added=${result.promptVersionsAdded}, ` +
      `catalogue=${result.catalogueAdded}, universal=${result.universalDatasetAdded}.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Неизвестная ошибка обновления МТР-агента.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase().catch(() => undefined);
  });
