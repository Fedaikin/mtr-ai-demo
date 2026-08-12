import { closeDatabase, getDatabaseKind, runMigrations } from "../src/adapters/persistence/db";

async function main(): Promise<void> {
  await runMigrations();
  const target = getDatabaseKind() === "postgres" ? "PostgreSQL" : "локальная PGlite";
  console.info(`Drizzle-миграции успешно применены: ${target}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Неизвестная ошибка миграции.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase().catch(() => undefined);
  });
