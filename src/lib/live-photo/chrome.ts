/**
 * 实况照片浏览器兜底（无头 Chrome）。
 *
 * 以下函数全部在 page.evaluate 内执行（回调被序列化发往浏览器，无法引用本模块
 * 作用域函数，故所有浏览器侧辅助函数都内联）。它们由回退编排器（./resolver）在
 * acquirePage 之后调用，自身不负责浏览器的 acquire/release。
 */
import { findItemInRouterData } from "../parser/extract";
import { scanLivePhotosInItem } from "./detect";
import { navigateNotePage } from "./navigate";
import type {
  ResolvedLivePhoto,
  PagePhotoStats,
  PageExtractResult,
  RouterDataExtractResult,
} from "./types";

/**
 * 在已加载的页面中遍历 React fiber 树，提取 aweme 的 images 数组，
 * 返回每个实况图片的 {index, imageUrl, videoUrl}。
 *
 * 注意：page.evaluate 的回调会被序列化后发往浏览器执行，无法引用本模块作用域的
 * 函数，因此所有辅助函数都内联在回调内部。
 */
async function extractPhotosFromPage(
  page: import("puppeteer-core").Page
): Promise<PageExtractResult> {
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
    const imageArrays: Record<string, unknown>[][] = [];
    // 候选数上限：仅用于限制内存，达到上限后不再追加新候选，
    // 但继续遍历以保留已收集候选中可能最优的一项
    const MAX_CANDIDATES = 100;

    function isImageLikeArray(obj: unknown[]): boolean {
      return (
        obj.length > 0 &&
        obj.every(
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
        )
      );
    }

    function scanObj(obj: unknown) {
      if (!obj || typeof obj !== "object" || visited.has(obj)) return;
      visited.add(obj);
      // 安全上限，防止极端页面下内存耗尽（配合下方主循环 n 上限双重保险）
      if ((visited as Set<unknown>).size > 1000000) return;

      if (Array.isArray(obj)) {
        if (isImageLikeArray(obj as unknown[])) {
          if (imageArrays.length < MAX_CANDIDATES) {
            imageArrays.push(obj as Record<string, unknown>[]);
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

    // 统计：找到的所有图片数组（含静态+实况）
    const stats: PagePhotoStats = {
      hasImageArray: imageArrays.length > 0,
      maxImageArrayLength: 0,
      liveCountInMaxArray: 0,
    };

    if (imageArrays.length > 0) {
      // 按长度选最大数组，计算其.live数量
      const maxArr = imageArrays.reduce((a, b) => (a.length >= b.length ? a : b));
      stats.maxImageArrayLength = maxArr.length;
      stats.liveCountInMaxArray = maxArr.filter((x) =>
        isLiveImage(x as Record<string, unknown>)
      ).length;
    }

    // 选择「含实况且图片数最多」的数组作为主 images 数组。
    // 混合图文帖里完整的 images 数组同时包含 普通图+实况图，长度最大，
    // 因此按数组长度（而非实况数）挑选最可靠，避免选到局部子集。
    let best: Record<string, unknown>[] | null = null;
    let bestLen = -1;
    for (const arr of imageArrays) {
      const live = arr.filter((x) => isLiveImage(x as Record<string, unknown>)).length;
      if (live > 0 && arr.length > bestLen) {
        bestLen = arr.length;
        best = arr;
      }
    }

    const out: ResolvedLivePhoto[] = [];
    if (best) {
      best.forEach((img, i) => {
        const im = img as Record<string, unknown>;
        if (!isLiveImage(im)) return;
        const imageUrl = extractImageUrl(im);
        const videoUrl = extractVideoUrl(im.video);
        if (videoUrl) {
          out.push({ index: i, imageUrl, videoUrl });
        }
      });
    }
    return { lives: out, stats };
  });

  return result as PageExtractResult;
}

/**
 * 在已加载页面中优先读取 window._ROUTER_DATA（服务端下发的完整 aweme，含全部
 * images / live_photo 标记 / douyinvod 短片 URL），用 scanLivePhotosInItem 扫描
 * 实况照片。比纯 fiber 遍历更可靠（不受 slides 懒渲染只暴露当前 slide 的影响），
 * fiber 遍历仅作为最后兜底。page.evaluate 回调会被序列化发往浏览器执行，故逻辑内联。
 */
async function extractLivePhotosFromRouterData(
  page: import("puppeteer-core").Page
): Promise<RouterDataExtractResult> {
  const rd = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const r = w._ROUTER_DATA;
    if (r) {
      try {
        return JSON.stringify(r);
      } catch {
        /* 序列化失败则尝试下方脚本扫描 */
      }
    }
    const scripts = Array.from(document.querySelectorAll("script"));
    for (const s of scripts) {
      const txt = s.textContent || "";
      const idx = txt.indexOf("_ROUTER_DATA");
      if (idx < 0) continue;
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
  });
  if (!rd) return { lives: [], hasData: false };
  const item = findItemInRouterData(rd);
  if (!item) return { lives: [], hasData: true };
  const lives = scanLivePhotosInItem(item, rd);
  return { lives, item, hasData: true };
}

export { extractPhotosFromPage, extractLivePhotosFromRouterData, navigateNotePage };
