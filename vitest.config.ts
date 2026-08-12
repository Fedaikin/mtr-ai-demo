import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    // Each persistence suite boots an isolated PGlite/WASM runtime. Two file
    // workers keep aggregate memory pressure below the default hook/test budgets.
    maxWorkers: 2,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/domain/**/*.ts", "src/application/**/*.ts"],
    },
  },
});
