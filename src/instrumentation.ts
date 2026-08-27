/**
 * Next.js 启动钩子：服务进程启动后预拉起共享浏览器，消除首条解析请求的冷启动成本。
 * 仅 nodejs 运行时生效；构建期与禁用浏览器兜底时跳过，避免 CI / 无 Chrome 环境报错。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // 构建阶段不预拉浏览器（next build 会执行 register，但此时不应常驻进程）
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.DISABLE_BROWSER_FALLBACK === "true") return;

  const { prewarmBrowser } = await import("./lib/browser-pool");
  prewarmBrowser();
  // 预收割浏览器会话凭证：让首条解析请求直接走更快的 a_bogus 桥接，而非先付浏览器兜底。
  const { prewarmBrowserCreds } = await import("./lib/browser-router-data");
  void prewarmBrowserCreds().catch(() => {});
}
