/**
 * 国内实况解析服务转发（Route C，零浏览器）。
 *
 * 当配置了 LIVE_PHOTO_SERVICE_URL 时，优先把 awemeId 转发给部署在**国内 IP** 的
 * live-photo-service（用 a_bogus 签名调 aweme/detail，返回含实况视频的完整 aweme）。
 * 海外 Vercel 直连抖音会被地理封锁返回空响应，故必须经由国内节点。
 *
 * 该路径能解析 slides 多图实况（SSR 扫描拿不到），是 Vercel 上 slides 实况的唯一
 * 可行来源（无需 Chrome）。未配置环境变量时返回 []，交由下方 SSR / 本地 Chrome 兜底。
 *
 * 安全：awemeId 为纯数字（来自已校验解析）；URL 由环境变量 base + 固定路径拼接，
 * 且携带 Bearer Token 鉴权，无 SSRF 面。
 */
import { logger } from "../logger";
import type { ResolvedLivePhoto } from "./types";

export async function resolveLivePhotosViaService(awemeId: string): Promise<ResolvedLivePhoto[]> {
  const base = process.env.LIVE_PHOTO_SERVICE_URL;
  if (!base) return [];
  const token = process.env.LIVE_PHOTO_SERVICE_TOKEN;
  const url = `${base.replace(/\/+$/, "")}/parse-live-photo?awemeId=${awemeId}`;
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { headers, redirect: "follow", signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      logger.warn("live-photo-svc", `国内服务返回 HTTP ${res.status}`);
      return [];
    }
    const json = (await res.json()) as {
      ok?: boolean;
      livePhotos?: ResolvedLivePhoto[];
    };
    if (!json.ok || !Array.isArray(json.livePhotos)) {
      logger.warn("live-photo-svc", "国内服务返回结构异常");
      return [];
    }
    return json.livePhotos;
  } catch (err) {
    logger.warn("live-photo-svc", "国内服务调用失败（将回退 SSR/Chrome）:", err);
    return [];
  }
}
