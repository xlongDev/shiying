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
    include: ["src/**/*.test.{ts,tsx}", "live-photo-service/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Parser pure functions + parseVideo 在 node 环境运行；组件测试用每文件
    // `// @vitest-environment jsdom` 指令切到 jsdom。
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.d.ts",
        "src/app/layout.tsx",
        "src/app/globals.css",
        "src/lib/abogus/**",
      ],
      // 覆盖率门禁（ratchet 地板）：当前实测约 stmts 31 / branch 28 / func 27 / lines 32，
      // 阈值略低于实测值以锁住“不允许倒退”。后续按阶段目标逐步抬升：
      // parser≥80 / lib≥60 / 组件≥50（需补齐组件与 lib 单测后上调）。
      thresholds: {
        statements: 30,
        branches: 26,
        functions: 25,
        lines: 31,
      },
    },
  },
});
