/**
 * 无头浏览器兜底：当 SSR（iesdouyin）与 a_bogus 签名 API 均不可用时，
 * 用真实 Chrome 加载抖音桌面页面，读取渲染后的 window._ROUTER_DATA 取得完整 aweme item。
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

// 与 live-photo-resolver.openNoteBrowser 同源的启动参数，保证本地无头浏览器稳定拉起
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
 * 等待抖音桌面页完成 hydration：出现图片查看器、note 容器或 video 即代表数据已挂载。
 * 与 live-photo-resolver 的 openNoteBrowser / navigateNotePage 保持一致，该逻辑已在本地验证可拿到实况数据。
 */
async function waitForHydration(
  page: import("puppeteer-core").Page,
  startTime: number
): Promise<void> {
  try {
    await page.waitForFunction(
      () =>
        !!document.querySelector(".dySwiperSlide") ||
        !!document.querySelector(".note-detail-container") ||
        !!document.querySelector("video"),
      { timeout: 5000 }
    );
  } catch {
    // 超时也继续，下方仍有固定等待兜底
  }
  logger.info("aweme-detail", `浏览器 hydration 检测完成 (${Date.now() - startTime}ms)`);

  // 短暂等待 React 完成渲染与数据注入
  await new Promise((r) => setTimeout(r, 500));
}

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
 * 在浏览器上下文内遍历 React fiber 树，尝试找到完整 aweme item。
 * 抖音桌面端 hydration 后，大量数据通过 fiber 传递，_ROUTER_DATA 可能不完整或结构不同。
 * 判定：对象含 desc + author + (music|statistics|video|images) 即可视为 item；
 * 若存在多个候选，优先匹配 aweme_id / awemeId === targetId。
 */
function extractItemFromFiberInPage(targetId: string): Record<string, unknown> | null {
  const seed =
    document.querySelector(".dySwiperSlide") ||
    document.querySelector(".note-detail-container") ||
    document.querySelector("video") ||
    document.body;
  const key = Object.keys(seed).find((k) => k.startsWith("__reactFiber"));
  if (!key) return null;

  const isItemLike = (o: unknown): boolean => {
    if (!o || typeof o !== "object") return false;
    const obj = o as Record<string, unknown>;
    const hasDesc = typeof obj.desc === "string";
    const hasAuthor = !!(obj.author && typeof obj.author === "object");
    const hasMusic = !!(obj.music && typeof obj.music === "object");
    const hasStats = !!(obj.statistics && typeof obj.statistics === "object");
    const hasVideo = !!(obj.video && typeof obj.video === "object");
    const hasImages = Array.isArray(obj.images);
    return hasDesc && hasAuthor && (hasMusic || hasStats || hasVideo || hasImages);
  };

  const getId = (o: unknown): string | undefined => {
    if (!o || typeof o !== "object") return undefined;
    const obj = o as Record<string, unknown>;
    const id = obj.aweme_id ?? obj.awemeId ?? obj.awemeIdList;
    return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
  };

  const visited = new Set<unknown>();
  const stack: unknown[] = [(seed as unknown as Record<string, unknown>)[key]];
  let bestMatch: Record<string, unknown> | null = null;

  while (stack.length) {
    const f = stack.pop() as Record<string, unknown> | undefined;
    if (!f || typeof f !== "object" || visited.has(f)) continue;
    visited.add(f);

    const props = f.memoizedProps;
    if (props && typeof props === "object") {
      const candidates: Record<string, unknown>[] = [];
      if (isItemLike(props)) candidates.push(props as Record<string, unknown>);

      // 否则在 props 子树中浅层搜索
      const queue: unknown[] = [props];
      const seen = new Set<unknown>();
      let n = 0;
      while (queue.length && n < 5000) {
        n++;
        const cur = queue.shift();
        if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
        seen.add(cur);
        if (isItemLike(cur)) candidates.push(cur as Record<string, unknown>);
        if (Array.isArray(cur)) {
          queue.push(...cur);
        } else {
          for (const k of Object.keys(cur)) {
            if (k.startsWith("__react")) continue;
            queue.push((cur as Record<string, unknown>)[k]);
          }
        }
      }

      for (const cand of candidates) {
        if (getId(cand) === targetId) return cand; // 精确匹配直接返回
        if (!bestMatch) bestMatch = cand; // 保留第一个遇到的候选
      }
    }

    if (f.child) stack.push(f.child);
    if (f.sibling) stack.push(f.sibling);
    if (f.return) stack.push(f.return);
  }
  return bestMatch;
}

/**
 * 通过无头浏览器获取完整 aweme item（含 video / images / author / music / statistics）。
 * 优先加载 www.douyin.com 桌面端（已被本地实况探测验证可用），
 * iesdouyin 分享页作为次选（桌面浏览器可能被 WAF）。
 *
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

    // 候选顺序：www.douyin.com 桌面端优先（被验证可绕过 WAF），iesdouyin 分享页作为次选
    const candidates = [
      `https://www.douyin.com/note/${awemeId}`,
      `https://www.douyin.com/video/${awemeId}`,
      `https://www.iesdouyin.com/share/note/${awemeId}/`,
      `https://www.iesdouyin.com/share/video/${awemeId}/`,
    ];

    for (const url of candidates) {
      const startTime = Date.now();
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

      const finalUrl = page.url();
      logger.info(
        "aweme-detail",
        `浏览器导航完成 ${url} -> ${finalUrl} (${Date.now() - startTime}ms)`
      );

      // 等 React hydration（抖音桌面端是 SPA，_ROUTER_DATA 可能 domcontentloaded 后才注入）
      await waitForHydration(page, startTime);

      // 尝试读取 _ROUTER_DATA
      let rd: string | null = null;
      try {
        rd = await page.evaluate(readRouterDataInPage);
      } catch (evalErr) {
        logger.warn(
          "aweme-detail",
          `读取 _ROUTER_DATA 异常:`,
          (evalErr as Error)?.message ?? evalErr
        );
      }

      const html = await page.content().catch(() => "");
      logger.info(
        "aweme-detail",
        `候选页状态: url=${finalUrl} htmlLen=${html.length} hasRouterInHtml=${html.includes("_ROUTER_DATA")} hasRouterData=${!!rd}`
      );

      if (rd) {
        const item = findItemInRouterData(rd);
        if (item) {
          logger.info(
            "aweme-detail",
            `浏览器兜底命中(_ROUTER_DATA) ${url} (${Date.now() - startTime}ms)`
          );
          await browser.close();
          puppeteerSemaphore.release();
          return item;
        }
        logger.warn("aweme-detail", `浏览器兜底读取到 _ROUTER_DATA 但未解析出 item ${url}`);
      }

      // _ROUTER_DATA 未命中：抖音桌面端数据可能只在 React fiber 中，遍历 fiber 兜底
      try {
        const fiberItem = await page.evaluate(extractItemFromFiberInPage, awemeId);
        if (fiberItem) {
          logger.info("aweme-detail", `浏览器兜底命中(fiber) ${url} (${Date.now() - startTime}ms)`);
          await browser.close();
          puppeteerSemaphore.release();
          return fiberItem;
        }
      } catch (fiberErr) {
        logger.warn("aweme-detail", `fiber 兜底异常:`, (fiberErr as Error)?.message ?? fiberErr);
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
