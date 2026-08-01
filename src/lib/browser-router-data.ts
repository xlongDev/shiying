/**
 * 无头浏览器兜底：当 SSR（iesdouyin）与 a_bogus 签名 API 均不可用时，
 * 用真实 Chrome 加载抖音页面，读取渲染后的 window._ROUTER_DATA 取得完整 aweme item。
 *
 * 为何需要这一环：
 *  - 抖音对裸 Node fetch 的 iesdouyin 分享页会做 WAF（首请求放行、同 IP 后续挑战），
 *    且 a_bogus 签名 API 在海外 IP 会被地理封锁、返回空响应；
 *  - 真实 Chrome 具备正确 TLS 指纹与 cookie 处理，几乎不触发 WAF，可稳定拿到 SSR 数据。
 *
 * 适用 / 不适用：
 *  - 本地开发机有系统 Chrome（puppeteer-core）时生效，覆盖"SSR 被 WAF + a_bogus 被封"的死局；
 *  - Vercel 等无 Chrome 环境：findChromeExecutable 返回 null，自动跳过，不会破坏构建。
 *
 * 注意：page.evaluate 的回调会被序列化后发往浏览器执行，不能引用模块作用域的
 * 变量 / 函数 / import，所有 DOM 读取逻辑必须内联在回调内部。
 */
import { findChromeExecutable } from "./chrome-finder";
import { puppeteerSemaphore } from "./concurrency";
import { logger } from "./logger";
import { findItemInRouterData } from "./parser/extract";

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 与 live-photo-resolver.loadNotePage 同源的启动参数，保证本地无头浏览器稳定拉起
const CHROME_LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--single-process",
  "--no-zygote",
  "--disable-gpu",
  "--disable-blink-features=AutomationControlled",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-sync",
  "--no-first-run",
  "--disable-web-security",
];

/**
 * 在浏览器上下文内读取 window._ROUTER_DATA（优先），缺失时回退扫描内联 <script>。
 * 必须保持自包含——仅使用 window / document / JSON 等浏览器全局，不得引用外部作用域。
 */
function readRouterDataInPage(): string | null {
  const w = window as unknown as Record<string, unknown>;
  const rd = w._ROUTER_DATA;
  if (rd) {
    try {
      return JSON.stringify(rd);
    } catch {
      /* 序列化失败则尝试下方脚本扫描 */
    }
  }
  const scripts = Array.from(document.querySelectorAll("script"));
  for (const s of scripts) {
    const txt = s.textContent || "";
    const idx = txt.indexOf("_ROUTER_DATA");
    if (idx < 0) continue;
    // 深度括号匹配，正确处理超大嵌套 JSON（比惰性正则稳健）
    const eq = txt.indexOf("=", idx);
    if (eq < 0) continue;
    const brace = txt.indexOf("{", eq);
    if (brace < 0) continue;
    let depth = 0;
    for (let i = brace; i < txt.length; i++) {
      const ch = txt[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return txt.slice(brace, i + 1);
      }
    }
  }
  return null;
}

/**
 * 通过无头浏览器获取完整 aweme item（含 video / images / author / music / statistics）。
 * @returns item 对象，或 null（无 Chrome / 导航失败 / 未找到 item）
 */
export async function loadRouterDataViaBrowser(
  awemeId: string
): Promise<Record<string, unknown> | null> {
  const chromePath = await findChromeExecutable();
  if (!chromePath) {
    logger.warn("aweme-detail", "未找到系统 Chrome，跳过浏览器兜底");
    return null;
  }

  let puppeteer: typeof import("puppeteer-core");
  try {
    puppeteer = await import("puppeteer-core");
  } catch (err) {
    logger.warn("aweme-detail", "puppeteer-core 未安装，跳过浏览器兜底", err);
    return null;
  }

  // 限制并发 Chrome 实例数，避免本地内存压力下多实例 OOM
  await puppeteerSemaphore.acquire();
  let browser: import("puppeteer-core").Browser | null = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: chromePath,
      args: CHROME_LAUNCH_ARGS,
    });

    const page = await browser.newPage();
    await page.setUserAgent(DESKTOP_UA);
    await page.setViewport({ width: 1280, height: 800 });
    await page.setCacheEnabled(true);

    // 候选顺序：iesdouyin 分享页（SSR 干净 _ROUTER_DATA，优先）→ douyin.com 桌面页（兜底）
    const candidates = [
      `https://www.iesdouyin.com/share/note/${awemeId}/`,
      `https://www.iesdouyin.com/share/video/${awemeId}/`,
      `https://www.douyin.com/note/${awemeId}`,
      `https://www.douyin.com/video/${awemeId}`,
    ];

    for (const url of candidates) {
      let gotoOk = true;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      } catch (gotoErr) {
        gotoOk = false;
        logger.warn(
          "aweme-detail",
          `浏览器导航未完成 ${url}:`,
          (gotoErr as Error)?.message ?? gotoErr
        );
      }
      if (!gotoOk) continue;

      // SSR 页面 _ROUTER_DATA 在初始 HTML 中，立即可读；SPA 可能需要等 hydration
      let rd: string | null = null;
      try {
        rd = await page.evaluate(readRouterDataInPage);
      } catch {
        /* ignore */
      }
      if (!rd) {
        try {
          await page.waitForFunction(
            () =>
              typeof (window as unknown as Record<string, unknown>)._ROUTER_DATA !== "undefined",
            { timeout: 4000 }
          );
          rd = await page.evaluate(readRouterDataInPage);
        } catch {
          /* ignore */
        }
      }

      if (rd) {
        const item = findItemInRouterData(rd);
        if (item) {
          logger.info("aweme-detail", `浏览器兜底命中 ${url}`);
          await browser.close();
          puppeteerSemaphore.release();
          return item;
        }
      }
    }

    logger.warn("aweme-detail", "浏览器兜底未找到 item");
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
    puppeteerSemaphore.release();
    return null;
  } catch (err) {
    logger.warn("aweme-detail", "浏览器兜底失败:", err);
    try {
      if (browser) await browser.close();
    } catch {
      /* ignore */
    }
    puppeteerSemaphore.release();
    return null;
  }
}
