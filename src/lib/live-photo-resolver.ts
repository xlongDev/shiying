import { findChromeExecutable } from "./chrome-finder";
import { puppeteerSemaphore } from "./concurrency";
import { logger } from "./logger";

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/* ------------------------------------------------------------------ */
/* 实况照片（LivePhoto）解析                                          */
/* ------------------------------------------------------------------ */

/**
 * 在抖音桌面版 note 页面中，实况照片的「动态短片」并不会在 SSR 中暴露 live_photo
 * 字段，也不会通过 hover/scroll 稳定触发网络请求。但页面 hydration 后，完整的
 * aweme 数据（含 images 数组）会存在于 React fiber 树中：
 *   - 普通图片：clipType === 2，video 为 null
 *   - 实况图片：clipType === 5 或 livePhotoType === 1，video 内含 douyinvod 短片 URL
 *
 * 因此最可靠的解析方式是：无头浏览器加载页面 → 遍历 React fiber → 找到 images 数组
 * → 按 clipType / livePhotoType 判定实况 → 从 video.bitRateList[0].playAddr 提取短片 URL。
 *
 * 该方式无需逐图 hover/导航，单次加载即可拿到全部实况图片的精确索引与资源，
 * 速度远快于逐图探测，且索引 100% 准确。
 */

export interface ResolvedLivePhoto {
  index: number;
  imageUrl: string;
  videoUrl: string;
}

/**
 * 在已加载的页面中遍历 React fiber 树，提取 aweme 的 images 数组，
 * 返回每个实况图片的 {index, imageUrl, videoUrl}。
 *
 * 注意：page.evaluate 的回调会被序列化后发往浏览器执行，无法引用本模块作用域的
 * 函数，因此所有辅助函数都内联在回调内部。
 */
async function extractLivePhotosFromPage(
  page: import("puppeteer-core").Page
): Promise<ResolvedLivePhoto[]> {
  const result = await page.evaluate(() => {
    function isLiveImage(im: Record<string, unknown>): boolean {
      // 兼容多种实况判定字段（不同时期/端命名不同）
      return (
        im.clipType === 5 ||
        im.clipType === "5" ||
        im.livePhotoType === 1 ||
        im.livePhotoType === "1" ||
        im.live_photo === true ||
        im.livePhoto === true ||
        im.isLivePhoto === true
      );
    }
    function extractVideoUrl(video: unknown): string {
      if (!video || typeof video !== "object") return "";
      const v = video as Record<string, unknown>;
      const bitRateList = Array.isArray(v.bitRateList) ? (v.bitRateList as unknown[]) : [];
      for (const item of bitRateList) {
        if (item && typeof item === "object") {
          const playAddr = (item as Record<string, unknown>).playAddr;
          if (Array.isArray(playAddr)) {
            for (const p of playAddr) {
              if (typeof p === "object" && (p as Record<string, unknown>).src) {
                const src = (p as Record<string, unknown>).src as string;
                if (src.includes("douyinvod")) return src;
              }
              if (typeof p === "string" && p.includes("douyinvod")) return p;
            }
          }
        }
      }
      const playAddr = v.playAddr;
      if (Array.isArray(playAddr)) {
        for (const p of playAddr) {
          if (typeof p === "object" && (p as Record<string, unknown>).src) {
            const src = (p as Record<string, unknown>).src as string;
            if (src.includes("douyinvod")) return src;
          }
          if (typeof p === "string" && p.includes("douyinvod")) return p;
        }
      }
      let found = "";
      const visit = (obj: unknown) => {
        if (found || !obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) {
          obj.forEach(visit);
          return;
        }
        for (const k of Object.keys(obj)) {
          if (k.startsWith("__react")) continue;
          const val = (obj as Record<string, unknown>)[k];
          if (typeof val === "string" && val.includes("douyinvod")) {
            found = val;
            return;
          }
          visit(val);
        }
      };
      visit(video);
      return found;
    }
    function extractImageUrl(img: Record<string, unknown>): string {
      // 兼容多种字段命名（Douyin 不同时期/端可能用 camelCase 或 snake_case）：
      //   urlList / url_list / imageUrl / originUrl / displayImage
      const candidates: unknown[] = [];
      if (img.urlList) candidates.push(img.urlList);
      if (img.url_list) candidates.push(img.url_list);
      if (img.imageUrl) candidates.push(img.imageUrl);
      if (img.originUrl) candidates.push(img.originUrl);
      if (img.displayImage) candidates.push(img.displayImage);

      const flatten = (src: unknown): string[] => {
        if (typeof src === "string") return [src];
        if (Array.isArray(src)) return src.flatMap(flatten);
        if (src && typeof src === "object") {
          const o = src as Record<string, unknown>;
          if (typeof o.url === "string") return [o.url];
          if (typeof o.uri === "string") return [o.uri];
          if (Array.isArray(o.url_list)) return (o.url_list as unknown[]).flatMap(flatten);
        }
        return [];
      };

      const all = candidates
        .flatMap(flatten)
        .filter((u): u is string => typeof u === "string" && u.length > 0);

      // 优先：douyinpic 静态图域名
      for (const u of all) {
        if (u.includes("douyinpic")) return u;
      }
      // 次优先：任意有效图片 URL
      for (const u of all) return u;
      return "";
    }

    // 获取任意 DOM 节点的 React fiber
    function getFiber(el: Element): Record<string, unknown> | null {
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
      return key
        ? ((el as unknown as Record<string, unknown>)[key] as Record<string, unknown>)
        : null;
    }

    const seedEl =
      document.querySelector(".dySwiperSlide") ||
      document.querySelector(".note-detail-container") ||
      document.querySelector("video") ||
      document.body;
    let start = getFiber(seedEl);
    if (!start) {
      let e: Element | null = document.body;
      while (e && !start) {
        start = getFiber(e);
        e = e.firstElementChild;
      }
    }
    if (!start) return [];

    const visited = new Set<unknown>();
    const candidates: Record<string, unknown>[][] = [];
    // 候选数上限：仅用于限制内存，达到上限后不再追加新候选，
    // 但继续遍历以保留已收集候选中可能最优的一项
    const MAX_CANDIDATES = 100;

    function scanObj(obj: unknown) {
      if (!obj || typeof obj !== "object" || visited.has(obj)) return;
      visited.add(obj);
      // 安全上限，防止极端页面下内存耗尽（配合下方主循环 n 上限双重保险）
      if ((visited as Set<unknown>).size > 1000000) return;

      if (Array.isArray(obj)) {
        const isImageLike =
          obj.length > 0 &&
          (obj as unknown[]).every(
            (x) =>
              x &&
              typeof x === "object" &&
              !("children" in (x as Record<string, unknown>)) &&
              ("clipType" in (x as Record<string, unknown>) ||
                "livePhotoType" in (x as Record<string, unknown>) ||
                "urlList" in (x as Record<string, unknown>) ||
                "url_list" in (x as Record<string, unknown>) ||
                "live_photo" in (x as Record<string, unknown>) ||
                "livePhoto" in (x as Record<string, unknown>) ||
                "isLivePhoto" in (x as Record<string, unknown>))
          );
        if (isImageLike) {
          // 快速计算该数组中的实况数量
          const liveInArr = (obj as unknown[]).filter((x) =>
            isLiveImage(x as Record<string, unknown>)
          ).length;
          if (liveInArr > 0) {
            if (candidates.length < MAX_CANDIDATES) {
              candidates.push(obj as Record<string, unknown>[]);
            }
          }
        }
        obj.forEach(scanObj);
        return;
      }

      for (const k of Object.keys(obj)) {
        if (k.startsWith("__react")) continue;
        scanObj((obj as Record<string, unknown>)[k]);
      }
    }

    const stack: unknown[] = [start];
    let n = 0;
    // 提高遍历上限：slides（混合图文）的 fiber 树较深，原 60k 可能在抵达
    // images 数组前就终止，导致混合实况漏检。提高到 200k。
    while (stack.length && n < 200000) {
      const f = stack.pop() as Record<string, unknown> | undefined;
      n++;
      if (!f || visited.has(f)) continue;
      scanObj(f.memoizedProps);
      scanObj(f.memoizedState);
      if (f.child) stack.push(f.child);
      if (f.sibling) stack.push(f.sibling);
      if (f.return) stack.push(f.return);
    }

    if (candidates.length === 0) return [];

    // 选择「含实况且图片数最多」的数组作为主 images 数组。
    // 混合图文帖里完整的 images 数组同时包含 普通图+实况图，长度最大，
    // 因此按数组长度（而非实况数）挑选最可靠，避免选到局部子集。
    let best: Record<string, unknown>[] | null = null;
    let bestLen = -1;
    for (const arr of candidates) {
      const live = arr.filter((x) => isLiveImage(x as Record<string, unknown>)).length;
      if (live > 0 && arr.length > bestLen) {
        bestLen = arr.length;
        best = arr;
      }
    }
    if (!best) return [];

    const out: ResolvedLivePhoto[] = [];
    best.forEach((img, i) => {
      const im = img as Record<string, unknown>;
      if (!isLiveImage(im)) return;
      const imageUrl = extractImageUrl(im);
      const videoUrl = extractVideoUrl(im.video);
      if (videoUrl) {
        out.push({ index: i, imageUrl, videoUrl });
      }
    });
    return out;
  });

  return result as ResolvedLivePhoto[];
}

async function loadNotePage(
  awemeId: string,
  path?: string
): Promise<import("puppeteer-core").Page | null> {
  const chromePath = findChromeExecutable();
  if (!chromePath) {
    logger.warn("live-photo", "未找到系统 Chrome，跳过实况探测");
    return null;
  }

  let puppeteer: typeof import("puppeteer-core");
  try {
    puppeteer = await import("puppeteer-core");
  } catch (err) {
    logger.warn("live-photo", "puppeteer-core 未安装，跳过实况探测", err);
    return null;
  }

  // 限制并发拉起的 Chrome 实例数，避免 serverless 受限内存下同时多实例 OOM
  await puppeteerSemaphore.acquire();

  let browser: import("puppeteer-core").Browser | null = null;
  try {
    const startTime = Date.now();
    browser = await puppeteer.launch({
      headless: true,
      executablePath: chromePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
        // 速度优化：禁用不必要的功能
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-default-apps",
        "--disable-sync",
        "--no-first-run",
        "--disable-web-security",
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(DESKTOP_UA);
    await page.setViewport({ width: 1280, height: 800 });

    // 速度优化：启用缓存，减少资源重复加载
    await page.setCacheEnabled(true);

    await page.goto(`https://www.douyin.com${path ?? `/note/${awemeId}`}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    console.log(`[live-page] 页面 DOM 加载完成 (${Date.now() - startTime}ms)`);

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
    console.log(`[live-page] hydration 检测完成 (${Date.now() - startTime}ms)`);

    // 短暂等待 React 完成渲染与数据注入（fiber 轮询会进一步兜底）
    await new Promise((r) => setTimeout(r, 500));

    // 轮询等待 fiber 树中确实出现含 clipType/livePhotoType 的图片数组
    // （避免页面未完全 hydration 就遍历导致探测偶发返回空）
    try {
      await page.waitForFunction(
        () => {
          const seed =
            document.querySelector(".dySwiperSlide") ||
            document.querySelector(".note-detail-container") ||
            document.querySelector("video") ||
            document.body;
          const key = Object.keys(seed).find((k) => k.startsWith("__reactFiber"));
          if (!key) return false;
          const visited = new Set<unknown>();
          const stack: unknown[] = [(seed as unknown as Record<string, unknown>)[key]];
          let n = 0;
          while (stack.length && n < 30000) {
            // 降低单次遍历上限
            const f = stack.pop() as Record<string, unknown> | undefined;
            n++;
            if (!f || typeof f !== "object" || visited.has(f)) continue;
            visited.add(f);
            const props = f.memoizedProps;
            if (props && typeof props === "object") {
              let found = false;
              const walk = (o: unknown) => {
                if (found || !o || typeof o !== "object") return;
                if (Array.isArray(o)) {
                  if (
                    o.length > 0 &&
                    (o as unknown[]).every(
                      (x) =>
                        x &&
                        typeof x === "object" &&
                        ("clipType" in (x as Record<string, unknown>) ||
                          "livePhotoType" in (x as Record<string, unknown>) ||
                          "url_list" in (x as Record<string, unknown>) ||
                          "urlList" in (x as Record<string, unknown>) ||
                          "live_photo" in (x as Record<string, unknown>) ||
                          "livePhoto" in (x as Record<string, unknown>))
                    )
                  ) {
                    found = true;
                    return;
                  }
                  o.forEach(walk);
                  return;
                }
                for (const k of Object.keys(o)) {
                  if (k.startsWith("__react")) continue;
                  walk((o as Record<string, unknown>)[k]);
                }
              };
              walk(props);
              if (found) return true;
            }
            if (f.child) stack.push(f.child);
            if (f.sibling) stack.push(f.sibling);
            if (f.return) stack.push(f.return);
          }
          return false;
        },
        { timeout: 6000, polling: 800 } // 超时 10s→6s，增加轮询间隔减少 CPU 消耗
      );
    } catch {
      // 超时也继续，下面的遍历仍有兜底
    }

    console.log(`[live-page] 页面完全就绪，总耗时 ${Date.now() - startTime}ms`);

    return page;
  } catch (err) {
    logger.error("live-photo", "加载 note 页面失败:", err);
    try {
      if (browser) await browser.close();
    } catch {
      /* ignore */
    }
    puppeteerSemaphore.release();
    return null;
  }
}

/**
 * 关闭实况探测页面并释放 puppeteer 并发许可。
 * 与 loadNotePage 内的 acquire 配对；loadNotePage 自身失败路径也会释放，
 * 此处仅在成功拿到 page 后由调用方 finally 调用，避免信号量许可泄漏导致排队死锁。
 */
async function closeNotePage(page: import("puppeteer-core").Page | null): Promise<void> {
  if (!page) return;
  try {
    await page.browser().close();
  } catch {
    /* ignore */
  } finally {
    puppeteerSemaphore.release();
  }
}

/**
 * 单图实况照片动态短片 URL 提取
 */
export async function resolveLivePhotoVideoUrl(awemeId: string): Promise<string | null> {
  if (process.env.DISABLE_LIVE_PHOTO_RESOLVE === "true") return null;

  const startTime = Date.now();
  const MAX_RETRIES = 3;
  let lastResult: ResolvedLivePhoto[] = [];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const page = await loadNotePage(awemeId);
    if (!page) return null;
    try {
      const lives = await extractLivePhotosFromPage(page);
      if (lives.length > 0) {
        console.log(
          `[live-photo] 单图实况探测完成（第${attempt}次），耗时 ${Date.now() - startTime}ms，结果: 有实况`
        );
        return lives[0].videoUrl;
      }
      lastResult = lives;
    } catch (err) {
      logger.error("live-photo", `第${attempt}次提取实况视频失败:`, err);
    } finally {
      await closeNotePage(page);
    }
    logger.warn("live-photo", `第${attempt}次单图实况探测为空，重试...`);
  }

  console.log(`[live-photo] 单图实况探测完成，耗时 ${Date.now() - startTime}ms，结果: 无实况`);
  return lastResult.length > 0 ? lastResult[0].videoUrl : null;
}

/**
 * 混合图文（slides）实况照片探测
 *
 * 返回值：ResolvedLivePhoto[] — 仅包含实况图片（clipType===5），
 * 每个元素带精确索引、静态原图 URL 与动态短片 URL。
 */
export async function resolveLivePhotosForSlides(
  awemeId: string,
  _imageCount: number
): Promise<ResolvedLivePhoto[]> {
  if (process.env.DISABLE_LIVE_PHOTO_RESOLVE === "true") return [];

  const startTime = Date.now();
  const MAX_RETRIES = 3;
  let lastResult: ResolvedLivePhoto[] = [];

  // slides 与普通 note 共用 /note/{id} 路由；但部分 slides 链接在桌面端
  // 仅于 /slides/{id} 完整渲染实况。依次尝试两条路径，命中即返回。
  const paths = [`/note/${awemeId}`, `/slides/${awemeId}`];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const page = await loadNotePage(awemeId, paths[0]);
    if (!page) return [];
    try {
      let lives = await extractLivePhotosFromPage(page);
      // 首条路径未命中实况时，尝试备用路径（同一浏览器会话内导航，避免重复启动开销）
      for (let p = 1; p < paths.length && lives.length === 0; p++) {
        try {
          await page.goto(`https://www.douyin.com${paths[p]}`, {
            waitUntil: "domcontentloaded",
            timeout: 15000,
          });
          await new Promise((r) => setTimeout(r, 600));
          await page
            .waitForFunction(
              () =>
                !!document.querySelector(".dySwiperSlide") ||
                !!document.querySelector(".note-detail-container") ||
                !!document.querySelector("video"),
              { timeout: 5000 }
            )
            .catch(() => {});
          lives = await extractLivePhotosFromPage(page);
        } catch {
          /* 备用路径失败，继续 */
        }
      }
      if (lives.length > 0) {
        console.log(
          `[live-photo-slides] 混合实况探测完成（第${attempt}次），耗时 ${Date.now() - startTime}ms，检测到 ${lives.length} 张实况照片`
        );
        return lives;
      }
      lastResult = lives;
    } catch (err) {
      logger.error("live-photo", `第${attempt}次混合实况探测失败:`, err);
    } finally {
      await closeNotePage(page);
    }
    logger.warn("live-photo-slides", `第${attempt}次混合实况探测为空，重试...`);
  }

  console.log(
    `[live-photo-slides] 混合实况探测完成，耗时 ${Date.now() - startTime}ms，检测到 0 张实况照片（已重试 ${MAX_RETRIES} 次）`
  );
  return lastResult;
}
