/**
 * 实况照片回退编排器（service → SSR → Chrome）。
 *
 * 实况识别策略（与 QingZai 思路一致）：
 * 1. 主路径（SSR 扫描，推荐）：移动端 UA 抓取 iesdouyin 分享页 HTML，从服务端渲染的
 *    `window._ROUTER_DATA` 直接读取完整 aweme，无需签名、也无需无头浏览器，可在 Vercel
 *    等 serverless 环境部署；对单图实况可在 Vercel 直接生效。
 * 2. 主路径（国内服务桥）：配置了 LIVE_PHOTO_SERVICE_URL 时，把 awemeId 转发给部署在
 *    国内 IP 的 live-photo-service（a_bogus 签名），能解析 slides 多图实况（SSR 拿不到），
 *    是 Vercel 上 slides 实况的唯一零浏览器来源。
 * 3. 回退路径（无头浏览器）：SSR / 服务均未命中（如多图 slides 实况）时，由本地系统
 *    Chrome 遍历 React fiber 兜底。Vercel 无 Chrome，回退自动跳过。
 *
 * 早期曾用 iesdouyin iteminfo 签名 API，现已被抖音强制 a_bogus 校验
 * （status_code:11110 encrypt_data_miss），已弃用。
 */
import { MOBILE_UA, extractRouterData, findItemInRouterData } from "../parser/extract";
import { acquirePage, releasePage } from "../browser-pool";
import { logger } from "../logger";
import { config } from "../config";
import { resolveLivePhotosViaService } from "./service";
import { resolveLivePhotosViaSsr } from "./ssr";
import { extractPhotosFromPage, extractLivePhotosFromRouterData, navigateNotePage } from "./chrome";
import { isDefinitelyStaticItem, isWafHtml, scanLivePhotosInItem } from "./detect";
import type { ResolvedLivePhoto, LivePhotoPresence, PagePhotoStats } from "./types";

/**
 * 单图实况照片动态短片 URL 提取
 */
export async function resolveLivePhotoVideoUrl(awemeId: string): Promise<string | null> {
  if (config.features.disableLivePhotoResolve) return null;

  // 主路径（若已配置国内服务）：转发至国内节点用 a_bogus 签名解析（零浏览器，可覆盖 slides）
  const svcStart = Date.now();
  const svcLives = await resolveLivePhotosViaService(awemeId);
  if (svcLives.length > 0) {
    console.log(`[live-photo] 单图实况 国内服务解析成功，耗时 ${Date.now() - svcStart}ms`);
    return svcLives[0].videoUrl;
  }

  // 主路径：SSR 扫描（无需签名/浏览器，Vercel 可部署；单图实况可在 Vercel 直接生效）
  const apiStart = Date.now();
  const apiLives = await resolveLivePhotosViaSsr(awemeId);
  if (apiLives.length > 0) {
    console.log(`[live-photo] 单图实况 SSR 解析成功，耗时 ${Date.now() - apiStart}ms`);
    return apiLives[0].videoUrl;
  }
  logger.warn("live-photo", "单图实况 SSR 未命中，回退无头浏览器");

  // 回退路径：无头浏览器（仅本地有系统 Chrome 时可用，Vercel 自动跳过）
  const page = await acquirePage();
  if (!page) return null;
  const startTime = Date.now();
  const MAX_RETRIES = 3;
  let lastResult: ResolvedLivePhoto[] = [];

  try {
    const ok = await navigateNotePage(page, `/note/${awemeId}`, startTime);
    if (!ok) return null;
    // 同一次浏览器会话内循环重提取，避免每次"为空"都重启 Chrome 烧 6s+
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      // P0：优先读 window._ROUTER_DATA（完整 aweme，不受 slides 懒渲染影响），fiber 仅兜底
      const { lives, item, hasData } = await extractLivePhotosFromRouterData(page);
      // 真静态帖短路：_ROUTER_DATA 完整且 images 中无任何实况标记，直接结束
      if (hasData && item && isDefinitelyStaticItem(item)) {
        console.log(
          `[live-photo] 单图实况探测（第${attempt}次）命中真静态帖短路(_ROUTER_DATA)，耗时 ${Date.now() - startTime}ms，结果: 无实况`
        );
        return null;
      }
      let finalLives = lives;
      let fiberStats: PagePhotoStats | null = null;
      if (finalLives.length === 0) {
        const pageResult = await extractPhotosFromPage(page);
        finalLives = pageResult.lives;
        fiberStats = pageResult.stats;
      }
      // 真静态帖短路（fiber）：已找到图片数组但里面一张实况都没有，无需重试
      if (fiberStats?.hasImageArray && fiberStats.liveCountInMaxArray === 0) {
        console.log(
          `[live-photo] 单图实况探测（第${attempt}次）命中真静态帖短路(fiber: ${fiberStats.maxImageArrayLength}张图/0实况)，耗时 ${Date.now() - startTime}ms，结果: 无实况`
        );
        return null;
      }
      if (finalLives.length > 0) {
        console.log(
          `[live-photo] 单图实况探测完成（第${attempt}次），耗时 ${Date.now() - startTime}ms，结果: 有实况`
        );
        return finalLives[0].videoUrl;
      }
      lastResult = finalLives;
      if (attempt < MAX_RETRIES) {
        logger.warn("live-photo", `第${attempt}次单图实况探测为空，重试...`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  } finally {
    await releasePage(page);
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
  if (config.features.disableLivePhotoResolve) return [];

  // 主路径（若已配置国内服务）：转发至国内节点用 a_bogus 签名解析。
  // slides 多图实况的动态短片 URL 不在 SSR 中，且海外直连被地理封锁，
  // 这是 Vercel 上解析 slides 实况的唯一零浏览器来源。
  const svcStart = Date.now();
  const svcLives = await resolveLivePhotosViaService(awemeId);
  if (svcLives.length > 0) {
    console.log(
      `[live-photo-slides] 混合实况 国内服务解析成功，耗时 ${Date.now() - svcStart}ms，检测到 ${svcLives.length} 张实况照片`
    );
    return svcLives;
  }

  // 主路径：SSR 扫描（一次请求拿全部 images，不受 slides/note 路由差异影响）
  const apiStart = Date.now();
  const apiLives = await resolveLivePhotosViaSsr(awemeId);
  if (apiLives.length > 0) {
    console.log(
      `[live-photo-slides] 混合实况 SSR 解析成功，耗时 ${Date.now() - apiStart}ms，检测到 ${apiLives.length} 张实况照片`
    );
    return apiLives;
  }
  logger.warn("live-photo-slides", "混合实况 SSR 未命中，回退无头浏览器");

  // 回退路径：无头浏览器（仅本地有系统 Chrome 时可用，Vercel 自动跳过）
  const page = await acquirePage();
  if (!page) return [];
  const startTime = Date.now();
  const MAX_RETRIES = 3;
  let lastResult: ResolvedLivePhoto[] = [];

  // slides 与普通 note 共用 /note/{id} 路由；但部分 slides 链接在桌面端
  // 仅于 /slides/{id} 完整渲染实况。依次尝试两条路径，命中即返回。
  const paths = [`/note/${awemeId}`, `/slides/${awemeId}`];

  try {
    const ok = await navigateNotePage(page, paths[0], startTime);
    if (!ok) return [];
    // 同一次浏览器会话内循环重提取，避免每次"为空"都重启 Chrome 烧 6s+
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      // P0：优先读 window._ROUTER_DATA（完整 aweme，不受 slides 懒渲染影响），fiber 仅兜底
      let rdResult = await extractLivePhotosFromRouterData(page);
      // 真静态帖短路：_ROUTER_DATA 完整且 images 中无任何实况标记，直接结束
      if (rdResult.hasData && rdResult.item && isDefinitelyStaticItem(rdResult.item)) {
        console.log(
          `[live-photo-slides] 混合实况探测（第${attempt}次）命中真静态帖短路(_ROUTER_DATA)，耗时 ${Date.now() - startTime}ms，结果: 0 张实况照片`
        );
        return [];
      }
      let lives = rdResult.lives;
      let fiberStats: PagePhotoStats | null = null;
      if (lives.length === 0) {
        const pageResult = await extractPhotosFromPage(page);
        lives = pageResult.lives;
        fiberStats = pageResult.stats;
      }
      // 真静态帖短路（fiber）：已找到图片数组但里面一张实况都没有，无需重试
      if (fiberStats?.hasImageArray && fiberStats.liveCountInMaxArray === 0) {
        console.log(
          `[live-photo-slides] 混合实况探测（第${attempt}次）命中真静态帖短路(fiber: ${fiberStats.maxImageArrayLength}张图/0实况)，耗时 ${Date.now() - startTime}ms，结果: 0 张实况照片`
        );
        return [];
      }
      // 首条路径未命中实况时，尝试备用路径（同一浏览器会话内导航）
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
          rdResult = await extractLivePhotosFromRouterData(page);
          if (rdResult.hasData && rdResult.item && isDefinitelyStaticItem(rdResult.item)) {
            console.log(
              `[live-photo-slides] 备用路径（${paths[p]}）命中真静态帖短路(_ROUTER_DATA)，结果: 0 张实况照片`
            );
            return [];
          }
          lives = rdResult.lives;
          fiberStats = null;
          if (lives.length === 0) {
            const pageResult = await extractPhotosFromPage(page);
            lives = pageResult.lives;
            fiberStats = pageResult.stats;
          }
          if (fiberStats?.hasImageArray && fiberStats.liveCountInMaxArray === 0) {
            console.log(
              `[live-photo-slides] 备用路径（${paths[p]}）命中真静态帖短路(fiber: ${fiberStats.maxImageArrayLength}张图/0实况)，结果: 0 张实况照片`
            );
            return [];
          }
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
      if (attempt < MAX_RETRIES) {
        logger.warn("live-photo-slides", `第${attempt}次混合实况探测为空，重试...`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  } finally {
    await releasePage(page);
  }

  console.log(
    `[live-photo-slides] 混合实况探测完成，耗时 ${Date.now() - startTime}ms，检测到 0 张实况照片（已重试 ${MAX_RETRIES} 次）`
  );
  return lastResult;
}

/**
 * 轻量预检：在不启动无头浏览器的前提下，快速判断 aweme 是否含实况照片。
 *
 * 路径（按优先级）：
 *   1) 国内实况服务（LIVE_PHOTO_SERVICE_URL）—— 零浏览器，可覆盖 slides/单图；
 *   2) iesdouyin 分享页 SSR（window._ROUTER_DATA）—— 移动端 UA，无需签名；
 *
 * 返回状态：
 *   - live：检测到实况照片，并附带 ResolvedLivePhoto 资源；
 *   - uncertain：SSR 未返回实况标记 / 被 WAF / 无 _ROUTER_DATA / 数据不完整。
 *
 * 重要：不再返回 "static"。抖音 SSR 分享页的 _ROUTER_DATA 对单图实况常常不暴露
 * live_photo / clipType / livePhotoType 等标记（图片对象只有 uri/url_list/宽高），
 * 若把"无标记"判定为 static 会严重漏检单图实况。因此只要没看到明确实况标记，
 * 一律返回 uncertain，交由调用方决定是否启动浏览器兜底。
 *
 * 注意：本函数故意不走无头浏览器兜底。uncertain 状态应交由调用方决定是否启动
 * 浏览器兜底探测，避免在预检阶段就白烧 Chrome 启动时间。
 */
export async function detectLivePhotoPresence(awemeId: string): Promise<LivePhotoPresence> {
  // 1. 国内服务（零浏览器，配置即最高优）
  try {
    const svcLives = await resolveLivePhotosViaService(awemeId);
    if (svcLives.length > 0) {
      return { status: "live", lives: svcLives };
    }
  } catch (err) {
    logger.warn("live-photo-presence", "国内服务预检失败:", err);
  }

  // 2. SSR 分享页（无需签名）
  const candidates = [
    `https://www.iesdouyin.com/share/note/${awemeId}/`,
    `https://www.iesdouyin.com/share/video/${awemeId}/`,
  ];

  for (const shareUrl of candidates) {
    try {
      const res = await fetch(shareUrl, {
        headers: {
          "user-agent": MOBILE_UA,
          referer: "https://www.douyin.com/",
          accept: "text/html",
        },
      });
      if (!res.ok) continue;

      const html = await res.text();
      if (isWafHtml(html)) {
        logger.warn("live-photo-presence", `SSR 预检被 WAF ${shareUrl}`);
        continue;
      }

      const rd = extractRouterData(html);
      if (!rd) continue;
      const item = findItemInRouterData(rd);
      if (!item) continue;

      const lives = scanLivePhotosInItem(item, rd);
      if (lives.length > 0) {
        return { status: "live", lives };
      }

      // 注意：这里不再把"SSR 拿到完整 images 但无实况标记"判定为 static。
      // 抖音 SSR 对单图实况的图片对象常常不暴露 live_photo/clipType 等标记，
      // 仅含 uri/url_list/宽高；此时若判 static 会漏检单图实况。
      // 没看到明确实况标记 → 返回 uncertain，由浏览器兜底保证正确性。
    } catch (err) {
      logger.warn("live-photo-presence", `SSR 预检失败 ${shareUrl}:`, err);
    }
  }

  return { status: "uncertain", reason: "API/SSR precheck inconclusive" };
}
