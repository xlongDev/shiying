import { NextRequest, NextResponse } from "next/server";
import { parseVideo, ParseError } from "@/lib/parser";
import { detectLivePhotoPresence } from "@/lib/live-photo-resolver";
import { guardRateLimit } from "@/lib/rate-limit-guard";
import { getParseCapability } from "@/lib/parse-capability";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // 第一道闸：按客户端 IP 限流，防止公开解析 API 被刷量 / 成本失控
  const blocked = await guardRateLimit(req, "parse", 20, 60_000);
  if (blocked) return blocked;

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
    //     * uncertain：API 无法判定（或 SSR 未暴露实况标记）→ 走静默后台探测
    //       （livePhotoBackground），由浏览器兜底。注意：预检不再返回 static，因为
    //       抖音 SSR 对单图实况常常不暴露 live_photo/clipType 等标记，若判 static 会漏检。

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
          } else {
            // uncertain：API 无法判定（或 SSR 未暴露实况标记），走静默浏览器兜底
            result.livePhotoBackground = true;
          }
        } catch (err) {
          logger.warn("parse", "实况预检失败，回退静默探测:", err);
          result.livePhotoBackground = true;
        }
      }
    }

    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    if (err instanceof ParseError) {
      // 后端降级（无 Chrome 且无国内服务）时，NO_ROUTER_DATA / SLIDES_NO_DATA
      // 是确定性的环境缺失而非链接问题，返回 503 + 可操作信息，而非笼统 400。
      if (err.code === "NO_ROUTER_DATA" || err.code === "SLIDES_NO_DATA") {
        const cap = await getParseCapability();
        if (cap.degraded) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "当前服务器缺少解析后端（未安装 Chrome 且未配置国内签名服务），无法解析该链接。请自托管并安装 Chrome，或配置 LIVE_PHOTO_SERVICE_URL。",
              code: "PARSE_BACKEND_UNAVAILABLE",
            },
            { status: 503 }
          );
        }
      }
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
