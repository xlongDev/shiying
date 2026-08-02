/**
 * 实况照片检测核心（纯函数，无副作用）。
 *
 * 承载「是否实况 / 从哪里抽短片 URL / 是否真静态帖 / 是否 WAF 页」四类纯逻辑，
 * 被 SSR 路径、国内服务路径、浏览器兜底路径共用。无任何 I/O、不依赖浏览器，
 * 可由单测稳定覆盖。
 */
import { pickBestImageUrl, pickFirstUrl, findItemInRouterData } from "../parser/extract";
import type { ResolvedLivePhoto } from "./types";

/** 判定单个图片对象是否为实况（兼容不同时期/端的字段命名） */
export function isLiveImageApi(im: Record<string, unknown>): boolean {
  return (
    im.clipType === 5 ||
    im.clipType === "5" ||
    im.livePhotoType === 1 ||
    im.livePhotoType === "1" ||
    im.live_photo === true ||
    (typeof im.live_photo === "object" && im.live_photo !== null) ||
    im.livePhoto === true ||
    im.isLivePhoto === true
  );
}

/** 从实况 video 对象中提取 douyinvod 短片 URL（兼容 url_list / play_addr / bitRateList） */
export function extractVideoUrlFromApi(video: unknown): string {
  if (!video || typeof video !== "object") return "";
  const v = video as Record<string, unknown>;
  const bitRateList = Array.isArray(v.bitRateList) ? (v.bitRateList as unknown[]) : [];
  for (const item of bitRateList) {
    if (item && typeof item === "object") {
      const playAddr = (item as Record<string, unknown>).playAddr;
      const arr = Array.isArray(playAddr) ? (playAddr as unknown[]) : [playAddr];
      for (const p of arr) {
        if (p && typeof p === "object" && (p as Record<string, unknown>).src) {
          const src = (p as Record<string, unknown>).src as string;
          if (src.includes("douyinvod")) return src;
        }
        if (typeof p === "string" && p.includes("douyinvod")) return p;
      }
    }
  }
  const playAddr = v.play_addr;
  if (playAddr && typeof playAddr === "object") {
    const u = pickFirstUrl((playAddr as Record<string, unknown>).url_list);
    if (u && u.includes("douyinvod")) return u;
  }
  return "";
}

/** 从实况 video 对象中提取 douyinvod 短片 URL，兼容 url_list / play_addr / bitRateList 多形态 */
export function extractLivePhotoVideoUrl(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  const o = v as Record<string, unknown>;
  const urlList = o.url_list ?? o.urlList;
  if (Array.isArray(urlList)) {
    for (const u of urlList) {
      if (typeof u === "string" && u.includes("douyinvod")) return u;
      if (u && typeof u === "object" && typeof (u as Record<string, unknown>).url === "string") {
        const s = (u as Record<string, unknown>).url as string;
        if (s.includes("douyinvod")) return s;
      }
    }
  }
  const playAddr = o.play_addr ?? o.playAddr;
  if (playAddr && typeof playAddr === "object") {
    const u = pickFirstUrl((playAddr as Record<string, unknown>).url_list);
    if (u && u.includes("douyinvod")) return u;
  }
  return extractVideoUrlFromApi(o);
}

/**
 * 判定 aweme item 是否为"明确的纯静态帖"：_ROUTER_DATA 完整返回了 images 数组，
 * 且其中没有任何实况标记；同时排除顶层 image_info.live_photo 的单图实况。
 * 满足该条件即可短路浏览器兜底，避免对真静态帖白烧重试。
 */
export function isDefinitelyStaticItem(item: Record<string, unknown>): boolean {
  const imageInfo = (item.image_info ?? {}) as Record<string, unknown>;
  if (imageInfo.live_photo === true || typeof imageInfo.live_photo === "object") {
    return false;
  }
  const images = Array.isArray(item.images) ? (item.images as unknown[]) : [];
  if (images.length === 0) return false;
  return images.every((img) => {
    if (!img || typeof img !== "object") return true;
    return !isLiveImageApi(img as Record<string, unknown>);
  });
}

const WAF_MARKERS = ["waf_js", "wafchallengeid", "argus-csp-token", "/waf-jschallenge/"];

/** 判断分享页 HTML 头部是否为抖音 WAF 挑战页（无 _ROUTER_DATA，解析无意义） */
export function isWafHtml(html: string): boolean {
  const head = html.slice(0, 6000).toLowerCase();
  return WAF_MARKERS.some((m) => head.includes(m));
}

/**
 * 纯函数：从 _ROUTER_DATA JSON 字符串扫描实况照片，返回 ResolvedLivePhoto[]。
 * 三条路径（与 QingZai 思路一致）：
 *   1) 顶层 image_info.live_photo（单图实况常见形态）
 *   2) images[] 数组中带 clipType===5 / livePhotoType===1 / live_photo 标记的图片
 *   3) 全局兜底：单图帖时扫描整段 JSON 中的 douyinvod URL（仿 QingZai findDouyinvodUrl）
 */
export function scanLivePhotosInItem(
  item: Record<string, unknown>,
  rd?: string
): ResolvedLivePhoto[] {
  const out: ResolvedLivePhoto[] = [];

  // 路径 1：顶层 image_info.live_photo
  const imageInfo = (item.image_info ?? {}) as Record<string, unknown>;
  const topLive = imageInfo.live_photo;
  if (topLive === true || (typeof topLive === "object" && topLive !== null)) {
    const lp = topLive === true ? {} : (topLive as Record<string, unknown>);
    const imgObj = (lp.image ?? (item.images as unknown[])?.[0]) as
      Record<string, unknown> | undefined;
    const imageUrl = imgObj ? pickBestImageUrl(imgObj) : "";
    const videoUrl = extractLivePhotoVideoUrl(lp.video);
    if (imageUrl && videoUrl) out.push({ index: 0, imageUrl, videoUrl });
  }

  // 路径 2：images[] 中的实况图片
  const images = Array.isArray(item.images) ? (item.images as unknown[]) : [];
  images.forEach((img, i) => {
    if (!img || typeof img !== "object") return;
    const im = img as Record<string, unknown>;
    if (!isLiveImageApi(im)) return;
    const imageUrl = pickBestImageUrl(im);
    const videoUrl = extractVideoUrlFromApi(im.video);
    if (imageUrl && videoUrl) out.push({ index: i, imageUrl, videoUrl });
  });

  if (out.length > 0) return out;

  // 路径 3：单图兜底，全局扫描 douyinvod（仿 QingZai findDouyinvodUrl）
  if (images.length === 1 && rd) {
    const m = rd.match(/https?:\/\/[^"\\\s)]*douyinvod[^"\\\s)]*/);
    if (m) {
      const imageUrl = pickBestImageUrl(images[0] as Record<string, unknown>);
      if (imageUrl) out.push({ index: 0, imageUrl, videoUrl: m[0] });
    }
  }
  return out;
}

export function scanLivePhotosInRouterData(rd: string): ResolvedLivePhoto[] {
  const item = findItemInRouterData(rd);
  if (!item) return [];
  return scanLivePhotosInItem(item, rd);
}
