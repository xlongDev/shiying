import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // 组件测试会经由组件内部 `@/lib/*` 等路径引入，需对齐 tsconfig 的 paths
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // Parser pure functions + parseVideo 在 node 环境运行；组件测试用每文件
    // `// @vitest-environment jsdom` 指令切到 jsdom。
  },
});
