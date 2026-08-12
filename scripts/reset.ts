import { resetDemoDatabase } from "../src/adapters/persistence/bootstrap";
import {
  closeDatabase,
  getDatabaseKind,
  isRemoteDatabaseConfigured,
} from "../src/adapters/persistence/db";

async function main(): Promise<void> {
  if (isRemoteDatabaseConfigured() && process.env.ALLOW_REMOTE_RESET !== "true") {
    throw new Error(
      "Удалённый reset заблокирован. Для осознанного demo-scoped reset повторите команду с ALLOW_REMOTE_RESET=true.",
    );
  }

  const counts = await resetDemoDatabase();
  const target = getDatabaseKind() === "postgres" ? "PostgreSQL" : "локальной PGlite";
  console.info(
    `Демо-данные атомарно восстановлены в ${target}: пользователей ${counts.users}, позиций Appius ${counts.canonicalPositions}, материалов SAP ${counts.sapMaterials}, остатков SAP ${counts.sapBalances}.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Неизвестная ошибка reset.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase().catch(() => undefined);
  });
