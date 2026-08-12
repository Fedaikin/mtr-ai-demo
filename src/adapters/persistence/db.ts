import { access, mkdir, readdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";

import { schema } from "./schema";

export type DatabaseKind = "postgres" | "pglite";
export type DatabaseMigrationIntent = "runtime" | "ensure" | "skip";
export type DatabaseMigrationDecision = "ensure" | "skip";

export interface DatabaseAccessOptions {
  /**
   * `runtime` preserves the convenient local/test bootstrap while keeping
   * Vercel request handlers read-only with respect to the schema. Bootstrap
   * and diagnostic boundaries should pass `ensure` or `skip` explicitly.
   */
  migrations?: DatabaseMigrationIntent;
}

/**
 * Both supported drivers expose the same Drizzle PostgreSQL query API.  The
 * PGlite type is used as the portable surface so repository code does not
 * need driver branches for every query.
 */
export type Database = PgliteDatabase<typeof schema>;

type Connection =
  | {
      kind: "postgres";
      db: PostgresJsDatabase<typeof schema>;
      client: Sql;
    }
  | {
      kind: "pglite";
      db: PgliteDatabase<typeof schema>;
      client: PGlite;
    };

interface DatabaseGlobalState {
  connection?: Promise<Connection>;
  migration?: Promise<void>;
}

const globalState = globalThis as typeof globalThis & {
  __mtrDatabaseState?: DatabaseGlobalState;
};

const state = (globalState.__mtrDatabaseState ??= {});

export function getDatabaseKind(): DatabaseKind {
  return hasRemoteDatabase() ? "postgres" : "pglite";
}

export function isRemoteDatabaseConfigured(): boolean {
  return hasRemoteDatabase();
}

/** Returns a lazily-created database connection under an explicit migration policy. */
export async function getDatabase(options: DatabaseAccessOptions = {}): Promise<Database> {
  const connection = await getConnection();
  const migrationDecision = resolveDatabaseMigrationDecision({
    intent: options.migrations ?? "runtime",
    isVercel: Boolean(process.env.VERCEL),
  });
  if (migrationDecision === "ensure") await ensureMigrated(connection);
  return connection.db as unknown as Database;
}

/**
 * Applies checked-in Drizzle migrations without seeding. This explicit
 * operational boundary always migrates, including on Vercel.
 */
export async function runMigrations(): Promise<void> {
  await getDatabase({ migrations: "ensure" });
}

export function resolveDatabaseMigrationDecision(input: {
  intent: DatabaseMigrationIntent;
  isVercel: boolean;
}): DatabaseMigrationDecision {
  if (input.intent === "ensure") return "ensure";
  if (input.intent === "skip") return "skip";
  return input.isVercel ? "skip" : "ensure";
}

/** Primarily useful for command-line scripts and isolated integration tests. */
export async function closeDatabase(): Promise<void> {
  const connectionPromise = state.connection;
  state.connection = undefined;
  state.migration = undefined;
  if (!connectionPromise) return;

  const connection = await connectionPromise;
  if (connection.kind === "postgres") {
    await connection.client.end({ timeout: 5 });
  } else {
    await connection.client.close();
  }
}

async function getConnection(): Promise<Connection> {
  state.connection ??= createConnection().catch((error: unknown) => {
    state.connection = undefined;
    throw error;
  });
  return state.connection;
}

async function createConnection(): Promise<Connection> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  assertDurableDatabaseConfiguration(Boolean(process.env.VERCEL), databaseUrl);
  if (databaseUrl) {
    // Prepared statements are intentionally disabled for transaction-pooling
    // PostgreSQL providers commonly used by Vercel previews.
    const client = postgres(databaseUrl, { prepare: false });
    return {
      kind: "postgres",
      client,
      db: drizzlePostgres(client, { schema }),
    };
  }

  const dataDir = resolvePgliteDataDir();
  if (!dataDir.startsWith("memory://")) {
    await mkdir(dirname(dataDir), { recursive: true });
  }
  const client = new PGlite(dataDir);
  return {
    kind: "pglite",
    client,
    db: drizzlePglite(client, { schema }),
  };
}

async function ensureMigrated(connection: Connection): Promise<void> {
  state.migration ??= migrateConnection(connection).catch((error: unknown) => {
    state.migration = undefined;
    throw error;
  });
  await state.migration;
}

async function migrateConnection(connection: Connection): Promise<void> {
  const migrationsFolder = await resolveMigrationsFolder();
  const config = {
    migrationsFolder,
    migrationsTable: "__mtr_migrations",
    migrationsSchema: "mtr_meta",
  } as const;

  try {
    if (connection.kind === "postgres") {
      await migratePostgres(connection.db, config);
    } else {
      await migratePglite(connection.db, config);
    }
  } catch (error) {
    throw new Error(
      `Не удалось применить Drizzle-миграции к ${connection.kind === "postgres" ? "PostgreSQL" : "локальной PGlite"}. Проверьте каталог drizzle/ и доступность базы.`,
      { cause: error },
    );
  }
}

async function resolveMigrationsFolder(): Promise<string> {
  const migrationsFolder = resolve(process.cwd(), "drizzle");
  try {
    await access(resolve(migrationsFolder, "meta", "_journal.json"));
    const entries = await readdir(migrationsFolder);
    if (entries.some((entry) => entry.endsWith(".sql"))) return migrationsFolder;
  } catch {
    // A precise, environment-safe error is raised below.
  }

  throw new Error(
    "Каталог Drizzle-миграций не найден или пуст. Ожидаются drizzle/meta/_journal.json и хотя бы один drizzle/*.sql; выполните `pnpm db:generate` из mtr-prototype.",
  );
}

function resolvePgliteDataDir(): string {
  const configured = process.env.PGLITE_DATA_DIR?.trim();
  if (configured?.startsWith("memory://")) return "memory://";
  if (configured) {
    return isAbsolute(configured)
      ? configured
      : resolve(/* turbopackIgnore: true */ process.cwd(), configured);
  }
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return "memory://";
  return resolve(process.cwd(), ".data", "mtr-pglite");
}

function hasRemoteDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function assertDurableDatabaseConfiguration(
  isVercel: boolean,
  databaseUrl: string | undefined,
): void {
  if (isVercel && !databaseUrl) {
    throw new Error(
      "Для Vercel обязателен DATABASE_URL: серверный runtime не должен использовать эфемерную PGlite.",
    );
  }
}
