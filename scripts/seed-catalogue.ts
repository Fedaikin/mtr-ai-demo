import { seedIndustrialCatalogue } from "../src/adapters/persistence/catalog-bootstrap";
import { closeDatabase, getDatabaseKind } from "../src/adapters/persistence/db";

async function main(): Promise<void> {
  const counts = await seedIndustrialCatalogue();
  const target = getDatabaseKind() === "postgres" ? "PostgreSQL" : "локальной PGlite";
  console.info(
    `Промышленный demo-каталог записан в ${target}: ${counts.catalogItems} позиций, ` +
      `${counts.catalogFamilies} семейств взаимозаменяемости, ${counts.catalogAssemblies} узлов, ` +
      `${counts.catalogBomLinks} BOM-связей и ${counts.catalogStockBalances} складских остатков.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Неизвестная ошибка seed промышленного каталога.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase().catch(() => undefined);
  });
