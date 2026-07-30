import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Parser pure functions + parseVideo run in node; component tests can use a
    // per-file `// @vitest-environment jsdom` directive when added later.
  },
});
