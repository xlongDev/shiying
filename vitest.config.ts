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
      // 覆盖率门禁：以当前实测水平（stmts 22.8 / branch 23.2 / func 20.5 / lines 23.3）为地板，
      // 锁住“不允许倒退”（略低于当前值 1 点留安全余量）。后续按 ratchet 目标逐步抬升：
      // parser≥80 / lib≥60 / 组件≥50，分阶段提高本阈值。
      thresholds: {
        statements: 21,
        branches: 22,
        functions: 19,
        lines: 22,
      },
    },
  },
});
