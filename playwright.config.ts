import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright 配置（P1-4 smoke）。
 * - webServer 启动 `pnpm dev`（端口 3000）。
 * - 仅 chromium 一个 project，跑 e2e/smoke.spec.ts。
 * - 因未预装浏览器二进制，本地需先 `pnpm exec playwright install chromium` 才能跑；
 *   CI 的 E2E job 当前在 .github/workflows/ci.yml 中注释保留，落地后再启用。
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
