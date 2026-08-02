/**
 * CDN / 平台识别单一数据源。
 *
 * 聚合所有"上游 URL 属于哪个平台"的判断，避免 proxy / stream / extract-audio /
 * live-compose / proxy-media 各自硬编码域名子串与 Referer 逻辑（历史上有 4 份
 * 近乎相同的 getHeaders 实现，新增 CDN 域名需改多处，漏改即行为不一致）。
 *
 * 注意：本模块只负责"按 URL 选 Referer / UA"这类展示层头部；SSRF 主机白名单
 * （ALLOWED_HOST_SUFFIXES）仍由 @/lib/ssrf 拥有并校验，此处仅 re-export 便于
 * 统一从 @/lib/cdn 引入。
 */
import { ALLOWED_HOST_SUFFIXES } from "./ssrf";

export { ALLOWED_HOST_SUFFIXES };

/** 代理请求使用的移动端 UA（与抖音 APP 近似，避免被 CDN 拒绝）。 */
export const PROXY_MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

/**
 * URL 子串标记：命中即判定为抖音系 CDN（用于选择 Referer）。
 * 取各代理路由历史实现的并集，新增 CDN 域名只需在此追加一处。
 */
const DOUYIN_URL_MARKERS = [
  "douyin",
  "snssdk",
  "douyinpic",
  "byteimg",
  "zjcdn",
  "bytecdn",
  "aweme",
  "douyinstatic",
  "douyinvod",
  "ixigua",
  "ies-music",
  "sign.douyinpic",
  "p11-sign",
  "p3-sign",
  "p26-sign",
  "p9-sign",
  "p5-sign",
  "sign",
];

const TIKTOK_URL_MARKERS = ["tiktok", "tiktokcdn", "tiktokv"];

export function isDouyinUrl(url: string): boolean {
  return DOUYIN_URL_MARKERS.some((m) => url.includes(m));
}

export function isTikTokUrl(url: string): boolean {
  return TIKTOK_URL_MARKERS.some((m) => url.includes(m));
}

/**
 * 为上游请求构建头部：移动端 UA + 按平台附加 Referer。
 * 统一替代各路由中重复的 getHeaders 实现。
 */
export function buildUpstreamHeaders(url: string): Record<string, string> {
  const headers: Record<string, string> = {
    "user-agent": PROXY_MOBILE_UA,
    accept: "*/*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  };

  if (isDouyinUrl(url)) {
    headers["referer"] = "https://www.douyin.com/";
  } else if (isTikTokUrl(url)) {
    headers["referer"] = "https://www.tiktok.com/";
  }

  return headers;
}
