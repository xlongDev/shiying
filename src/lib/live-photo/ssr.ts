/**
 * 主路径：SSR 扫描（移动端 UA + 解析 window._ROUTER_DATA）。
 *
 * 借鉴 QingZai：抖音服务端把完整 aweme 嵌进分享页 HTML，无需签名。
 * 用移动端 UA 抓取 iesdouyin 分享页，从 SSR HTML 中直接读取完整 aweme，
 * 按 image_info.live_photo / clipType===5 / livePhotoType===1 判定实况。
 * 无需签名、也无需无头浏览器，因此可在 Vercel 等 serverless 环境运行。
 *
 * 注：早期曾用 iesdouyin iteminfo 签名 API，但现已被抖音强制 a_bogus 签名校验
 * （返回 status_code:11110 encrypt_data_miss），已弃用。
 */
import { MOBILE_UA, extractRouterData } from "../parser/extract";
import { fetchAwemeItem } from "../parser/aweme-detail";
import { logger } from "../logger";
import { isWafHtml, scanLivePhotosInRouterData, scanLivePhotosInItem } from "./detect";
import type { ResolvedLivePhoto } from "./types";

/**
 * 主路径：移动端 UA 抓取 iesdouyin 分享页 SSR HTML，解析 window._ROUTER_DATA
 * 提取实况照片。无需签名、无需浏览器；可在 Vercel 直接运行。
 * 失败（接口变更 / 区域不可见等）返回 []，由调用方回退无头浏览器。
 *
 * 安全：awemeId 为纯数字（来自已校验的解析），URL 固定拼接，无 SSRF 面。
 */
export async function resolveLivePhotosViaSsr(awemeId: string): Promise<ResolvedLivePhoto[]> {
  // 路径 1：SSR 分享页（最快）
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
      // WAF 挑战页没有 _ROUTER_DATA，直接走下方 API 兜底
      if (isWafHtml(html)) {
        logger.warn("live-photo-ssr", `SSR 被 WAF 拦截 ${shareUrl}`);
        continue;
      }
      const rd = extractRouterData(html);
      if (!rd) continue;
      const lives = scanLivePhotosInRouterData(rd);
      if (lives.length > 0) return lives;
    } catch (err) {
      logger.warn("live-photo-ssr", `SSR 扫描失败 ${shareUrl}:`, err);
    }
  }

  // 路径 2：a_bogus 签名 API（国内 IP 可用；SSR 被 WAF 时的兜底）
  logger.warn("live-photo-ssr", "SSR 未命中实况，回退 a_bogus 签名 API 扫描");
  const item = await fetchAwemeItem(awemeId);
  if (item) {
    const lives = scanLivePhotosInItem(item);
    if (lives.length > 0) return lives;
  }
  return [];
}

/**
 * 移动端 UA 抓取 iesdouyin 分享页 SSR，返回完整 aweme item（含 music / 视频等字段）。
 * 现在内部复用 fetchAwemeItem，因此 SSR 被 WAF 时会自动回退 a_bogus 签名 API。
 *
 * 安全：awemeId 为纯数字（来自已校验解析）；URL 固定拼接，无 SSRF 面。
 */
export async function fetchAwemeItemViaSsr(
  awemeId: string
): Promise<Record<string, unknown> | null> {
  return fetchAwemeItem(awemeId);
}
