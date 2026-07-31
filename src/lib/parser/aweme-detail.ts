/**
 * 统一获取抖音 aweme item（完整视频/图文元数据）。
 *
 * 提供多源 fallback，以应对抖音对单一来源的反爬/封锁：
 *   1) SSR 分享页（iesdouyin.com/share/{note|video}/{id}/）—— 无需签名，但可能被 WAF；
 *   2) a_bogus 签名 API（www.douyin.com/aweme/v1/web/aweme/detail/）—— 需国内 IP；
 *   3) 桌面版无头浏览器（本地有 Chrome 时）—— 通用兜底，但慢且 Vercel 不可用。
 *
 * note.ts / slides.ts / live-photo-resolver.ts / download-music.ts 统一从这里取 item，
 * 避免各模块重复实现不一致的提取/兜底逻辑。
 */

import { signAwemeDetail } from "@/lib/abogus";
import { logger } from "@/lib/logger";
import { MOBILE_UA, extractRouterData, findItemInRouterData } from "./extract";

/** 判断响应是否为抖音 WAF JS Challenge 页（非正常的 SSR 分享页） */
function isWafResponse(html: string): boolean {
  const marker = html.slice(0, 6000).toLowerCase();
  return (
    marker.includes("waf_js") ||
    marker.includes("wafchallengeid") ||
    marker.includes("argus-csp-token") ||
    marker.includes("/waf-jschallenge/")
  );
}

/** 从 iesdouyin 分享页 SSR 读取完整 aweme item */
async function fetchAwemeItemFromSsr(awemeId: string): Promise<Record<string, unknown> | null> {
  const candidates = [
    `https://www.iesdouyin.com/share/note/${awemeId}/`,
    `https://www.iesdouyin.com/share/video/${awemeId}/`,
  ];

  for (const shareUrl of candidates) {
    try {
      const res = await fetch(shareUrl, {
        headers: {
          "user-agent": MOBILE_UA,
          accept: "text/html",
          "accept-language": "zh-CN,zh;q=0.9",
          referer: "https://www.douyin.com/",
        },
      });
      if (!res.ok) {
        logger.warn("aweme-detail", `SSR ${shareUrl} HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      if (isWafResponse(html)) {
        logger.warn("aweme-detail", `SSR ${shareUrl} 被 WAF 拦截`);
        continue;
      }
      const rd = extractRouterData(html);
      if (!rd) {
        logger.warn("aweme-detail", `SSR ${shareUrl} 无 _ROUTER_DATA`);
        continue;
      }
      const item = findItemInRouterData(rd);
      if (item) return item;
    } catch (err) {
      logger.warn("aweme-detail", `SSR ${shareUrl} 失败:`, err);
    }
  }
  return null;
}

/** 从 a_bogus 签名 API 读取完整 aweme item（国内 IP 可用） */
async function fetchAwemeItemFromApi(awemeId: string): Promise<Record<string, unknown> | null> {
  try {
    // 合成 ttwid 足以通过多数场景；真实 ttwid 需要额外请求首页，反而增加被 WAF 的概率。
    const sig = await signAwemeDetail(awemeId, { forceSyntheticTtwid: true });
    const res = await fetch(sig.url, {
      headers: sig.headers,
      redirect: "follow",
    });
    if (!res.ok) {
      logger.warn("aweme-detail", `a_bogus API HTTP ${res.status}`);
      return null;
    }
    const txt = await res.text();
    if (!txt || txt.length < 100) {
      logger.warn("aweme-detail", "a_bogus API 空响应（可能是海外 IP 地理封锁）");
      return null;
    }
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(txt);
    } catch {
      logger.warn("aweme-detail", "a_bogus API 返回非 JSON（可能被 WAF）");
      return null;
    }
    if (json.status_code !== 0) {
      logger.warn("aweme-detail", `a_bogus API status_code=${json.status_code}`);
      return null;
    }
    const detail = json.aweme_detail as Record<string, unknown> | undefined;
    if (!detail || typeof detail !== "object") {
      logger.warn("aweme-detail", "a_bogus API 无 aweme_detail");
      return null;
    }
    return detail;
  } catch (err) {
    logger.warn("aweme-detail", "a_bogus API 失败:", err);
    return null;
  }
}

/**
 * 多源获取 aweme item。
 * @returns 完整 item 对象，或 null（表示当前网络环境无法获取）
 */
export async function fetchAwemeItem(awemeId: string): Promise<Record<string, unknown> | null> {
  // 路径 1：SSR（最快，无需签名）
  const ssrItem = await fetchAwemeItemFromSsr(awemeId);
  if (ssrItem) return ssrItem;

  // 路径 2：a_bogus 签名 API（国内 IP 可用，海外会空响应）
  logger.warn("aweme-detail", "SSR 未命中，回退 a_bogus 签名 API");
  const apiItem = await fetchAwemeItemFromApi(awemeId);
  if (apiItem) return apiItem;

  return null;
}
