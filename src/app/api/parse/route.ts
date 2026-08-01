import { NextRequest, NextResponse } from "next/server";
import { parseVideo, ParseError } from "@/lib/parser";
import { detectLivePhotoPresence } from "@/lib/live-photo-resolver";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

/** 从请求头提取客户端 IP（兼容反向代理 / 直连）。 */
function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // 第一道闸：按客户端 IP 限流，防止公开解析 API 被刷量 / 成本失控
  const rl = rateLimit(`parse:${getClientIp(req)}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "请求过于频繁，请稍后再试", code: "RATE_LIMITED" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const url: string = body?.url ?? "";
    const skipLivePhoto: boolean = body?.skipLivePhoto ?? false;

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { ok: false, error: "请输入视频链接", code: "EMPTY_URL" },
        { status: 400 }
      );
    }

    const result = await parseVideo(url, { skipLivePhoto });

    // 跳过实况解析（skipLivePhoto=true）且 SSR 未直接拿到实况资源时，决定是否异步探测。
    // - slides（混合图文）：确定性可能含实况 → 骨架屏 pending + 「探测未完成」重试面板
    // - note（含单图/多图）：先做一次轻量纯 API 预检（国内服务 / SSR 分享页），判定：
    //     * live：检测到实况 → 单图直接填充实况资源；否则显示 pending 由前端二次探测
    //     * static：SSR 明确无实况标记 → 不探测、不提示，避免对真静态帖误报
    //     * uncertain：API 无法判定 → 走静默后台探测（livePhotoBackground），由浏览器兜底
    //   这样单图实况在 API 可识别时会给用户反馈，真静态帖又不会白烧浏览器。

    if (skipLivePhoto && !result.isLivePhoto && result.isImagePost) {
      if (result.contentType === "slides") {
        result.livePhotoPending = true;
      } else if (result.contentType === "note") {
        try {
          const presence = await detectLivePhotoPresence(result.awemeId);
          if (presence.status === "live") {
            // 单图实况：API 已返回完整资源，直接展示实况 UI，无需二次探测
            if (presence.lives.length === 1 && result.images?.length === 1) {
              result.isLivePhoto = true;
              result.livePhoto = {
                imageUrl: presence.lives[0].imageUrl || result.images[0],
                videoUrl: presence.lives[0].videoUrl,
                musicUrl: result.musicUrl || "",
              };
            } else {
              // 多实况或资源不齐：显示「正在探测实况」骨架屏
              result.livePhotoPending = true;
            }
          } else if (presence.status === "uncertain") {
            // API 无法判定，走静默浏览器兜底
            result.livePhotoBackground = true;
          }
          // status === "static"：API 已确认无实况，不探测、不提示
        } catch (err) {
          logger.warn("parse", "实况预检失败，回退静默探测:", err);
          result.livePhotoBackground = true;
        }
      }
    }

    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof ParseError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: 400 });
    }
    logger.error("parse", "unexpected error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "解析失败，请稍后重试或更换链接",
        code: "UNKNOWN",
      },
      { status: 500 }
    );
  }
}
