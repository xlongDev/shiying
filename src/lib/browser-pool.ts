/**
 * 共享无头浏览器池（单例）。
 *
 * 抖音解析在海外 IP / 被 WAF 时，SSR 与 a_bogus 签名 API 均不可达，
 * 只能靠本地系统 Chrome 兜底。若每次请求都冷启动一台 Chrome（~4s 启动 +
 * ~4s 导航），单图实况 / 静态帖兜底都要白烧 8s+，且 --single-process 下多实例
 * 极不稳定。本模块提供**常驻共享浏览器**：首请求付一次冷启动成本，后续请求
 * 复用 warm 浏览器，仅开/关 page，将单次兜底压到 3~4s。
 *
 * 关键点：
 *  - 仅一个常驻 Browser 实例（跨所有解析 / 实况探测请求复用）；
 *  - puppeteerSemaphore 在此语义下限制**并发 page 数**（而非 Chrome 实例数），
 *    避免单台浏览器被压垮 / OOM；
 *  - 浏览器进程崩溃（disconnected）自动置空，下次请求重启动；
 *  - 进程退出（SIGINT / SIGTERM）关闭浏览器，避免孤儿 Chrome 占用资源；
 *  - 不使用 --single-process / --no-zygote（多 page 下不稳定，已移除）。
 *
 * 安全：page.evaluate 回调会被序列化发往浏览器执行，不能引用模块作用域的
 * 变量 / 函数 / import，所有 DOM 读取逻辑必须内联在回调内部。
 */
import { findChromeExecutable } from "./chrome-finder";
import { puppeteerSemaphore } from "./concurrency";
import { logger } from "./logger";

export const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** 启动参数：多 page 稳定优先，移除不稳定的 --single-process / --no-zygote */
export const CHROME_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-blink-features=AutomationControlled",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-sync",
  "--no-first-run",
  "--disable-web-security",
];

let sharedBrowser: import("puppeteer-core").Browser | null = null;
let browserLaunchPromise: Promise<import("puppeteer-core").Browser | null> | null = null;
let cleanupRegistered = false;

/** 进程退出时关闭常驻浏览器（仅注册一次），避免孤儿 Chrome 占用资源 */
function registerBrowserCleanup(browser: import("puppeteer-core").Browser): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  const closeOnce = () => {
    browser.close().catch(() => {});
  };
  process.once("SIGINT", closeOnce);
  process.once("SIGTERM", closeOnce);
}

/**
 * 获取常驻共享浏览器实例。
 * - 已连接则直接复用（warm）；
 * - 正在启动则返回已有启动 Promise（避免并发重复拉起）；
 * - 未启动则冷启动一台；无系统 Chrome / puppeteer 未安装返回 null。
 *
 * 注意：本函数不持有 puppeteerSemaphore（信号量用于限制并发 page，见 acquirePage）。
 */
export async function getSharedBrowser(): Promise<import("puppeteer-core").Browser | null> {
  if (sharedBrowser && sharedBrowser.connected) {
    return sharedBrowser;
  }
  if (browserLaunchPromise) return browserLaunchPromise;

  browserLaunchPromise = (async () => {
    const chromePath = await findChromeExecutable();
    if (!chromePath) {
      logger.warn("browser-pool", "未找到系统 Chrome，跳过浏览器兜底");
      browserLaunchPromise = null;
      return null;
    }

    let puppeteer: typeof import("puppeteer-core");
    try {
      puppeteer = await import("puppeteer-core");
    } catch (err) {
      logger.warn("browser-pool", "puppeteer-core 未安装，跳过浏览器兜底", err);
      browserLaunchPromise = null;
      return null;
    }

    try {
      const b = await puppeteer.launch({
        headless: true,
        executablePath: chromePath,
        args: CHROME_ARGS,
      });
      b.on("disconnected", () => {
        // 进程崩溃：置空，下次请求重启动
        sharedBrowser = null;
        browserLaunchPromise = null;
      });
      sharedBrowser = b;
      registerBrowserCleanup(b);
      logger.info("browser-pool", "启动常驻浏览器（cold）");
      return b;
    } catch (err) {
      logger.warn("browser-pool", "共享浏览器启动失败:", err);
      sharedBrowser = null;
      browserLaunchPromise = null;
      return null;
    }
  })();

  return browserLaunchPromise;
}

/**
 * 从共享浏览器获取一个 page（供解析 / 实况探测使用）。
 * 获取并发许可（限制并发 page 数）；无系统 Chrome / 启动失败时返回 null。
 * 返回的 page 用完后务必通过 releasePage 关闭，切勿关闭共享浏览器本身。
 */
export async function acquirePage(): Promise<import("puppeteer-core").Page | null> {
  // 先占位信号量，避免"拿到浏览器但创建 page 失败"时许可泄漏
  await puppeteerSemaphore.acquire();
  try {
    const browser = await getSharedBrowser();
    if (!browser) {
      puppeteerSemaphore.release();
      return null;
    }
    const page = await browser.newPage();
    await page.setUserAgent(DESKTOP_UA);
    await page.setViewport({ width: 1280, height: 800 });
    await page.setCacheEnabled(true);
    return page;
  } catch (err) {
    logger.warn("browser-pool", "打开 page 失败:", err);
    puppeteerSemaphore.release();
    return null;
  }
}

/**
 * 关闭 page 并释放并发许可。只关 page，不关共享浏览器（复用池）。
 */
export async function releasePage(page: import("puppeteer-core").Page | null): Promise<void> {
  if (page) {
    try {
      await page.close();
    } catch {
      /* ignore */
    }
  }
  puppeteerSemaphore.release();
}

/**
 * 导航到目标 URL 并等待页面 hydration（出现图片查看器 / note 容器 / video 即代表
 * 数据已挂载），随后轮询等待 _ROUTER_DATA 注入或 fiber 就绪，避免 SPA 异步注入
 * 数据途中就读取导致漏检 / Execution context destroyed。
 *
 * 返回 false 仅当导航本身异常（超时 / 被中断）；不代表页面无内容。
 */
export async function navigateAndWait(
  page: import("puppeteer-core").Page,
  url: string,
  timeoutMs = 15000
): Promise<boolean> {
  const startTime = Date.now();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  } catch (gotoErr) {
    logger.warn("browser-pool", `导航未完成 ${url}:`, (gotoErr as Error)?.message ?? gotoErr);
    return false;
  }

  // 等待 hydration：页面出现图片查看器或视频即代表数据已挂载
  try {
    await page.waitForFunction(
      () =>
        !!document.querySelector(".dySwiperSlide") ||
        !!document.querySelector(".note-detail-container") ||
        !!document.querySelector("video"),
      { timeout: 5000 }
    );
  } catch {
    // 超时也继续，下面仍有固定等待兜底
  }

  // 轮询等待数据注入（_ROUTER_DATA 出现或 fiber 已挂载数据节点）
  try {
    await page.waitForFunction(
      () => {
        const w = window as unknown as Record<string, unknown>;
        if (w._ROUTER_DATA) return true;
        const seed =
          document.querySelector(".dySwiperSlide") ||
          document.querySelector(".note-detail-container") ||
          document.querySelector("video") ||
          document.body;
        if (!seed) return false;
        const key = Object.keys(seed).find((k) => k.startsWith("__reactFiber"));
        return !!key;
      },
      { timeout: 6000, polling: 800 }
    );
  } catch {
    // 超时也继续，下面的提取仍有兜底
  }

  logger.info("browser-pool", `页面就绪 ${url} (${Date.now() - startTime}ms)`);
  return true;
}
