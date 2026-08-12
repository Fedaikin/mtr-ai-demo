import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/adapters/persistence/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // `generate` is offline. Commands that connect must receive the real URL.
    url: process.env.DATABASE_URL ?? "postgres://demo:demo@127.0.0.1:5432/mtr_demo",
  },
  migrations: {
    table: "__mtr_migrations",
    schema: "mtr_meta",
  },
  strict: true,
  verbose: true,
});
