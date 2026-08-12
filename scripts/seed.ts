import { seedDatabase } from "../src/adapters/persistence/bootstrap";
import { closeDatabase, getDatabaseKind } from "../src/adapters/persistence/db";

async function main(): Promise<void> {
  const counts = await seedDatabase();
  const target = getDatabaseKind() === "postgres" ? "PostgreSQL" : "локальной PGlite";
  console.info(
    `Канонический seed записан в ${target}: пользователей ${counts.users}, позиций Appius ${counts.canonicalPositions}, материалов SAP ${counts.sapMaterials}, остатков SAP ${counts.sapBalances}.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Неизвестная ошибка seed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase().catch(() => undefined);
  });
