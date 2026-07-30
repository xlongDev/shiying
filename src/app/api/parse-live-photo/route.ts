import { NextRequest, NextResponse } from "next/server";
import { resolveLivePhotoVideoUrl, resolveLivePhotosForSlides } from "@/lib/live-photo-resolver";
import type { LivePhotoInfo } from "@/lib/parser";
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
  // 第一道闸：实况探测需拉起无头浏览器（高成本），限流更紧
  const rl = rateLimit(`live:${getClientIp(req)}`, 6, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "实况探测请求过于频繁，请稍后再试", code: "RATE_LIMITED" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
      }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const mode: string = body?.mode ?? "single";
    const awemeId: string = body?.awemeId ?? "";

    if (!awemeId) {
      return NextResponse.json({ ok: false, error: "缺少 awemeId" }, { status: 400 });
    }

    if (mode === "slides") {
      // 混合图文实况探测
      const imageUrls: string[] = body?.imageUrls ?? [];
      const musicUrl: string = body?.musicUrl ?? "";

      if (imageUrls.length === 0) {
        return NextResponse.json({ ok: false, error: "缺少图片 URL 列表" }, { status: 400 });
      }

      const lives = await resolveLivePhotosForSlides(awemeId, imageUrls.length);
      const livePhotos: LivePhotoInfo[] = [];

      for (const lp of lives) {
        livePhotos.push({
          imageUrl: lp.imageUrl || (lp.index < imageUrls.length ? imageUrls[lp.index] : ""),
          videoUrl: lp.videoUrl,
          musicUrl,
          index: lp.index,
        });
      }

      return NextResponse.json({
        ok: true,
        data: {
          isMixedLivePhoto: livePhotos.length > 0,
          livePhotos,
          // 如果所有图片都是实况（单图实况兼容）
          isLivePhoto: livePhotos.length === imageUrls.length && imageUrls.length === 1,
          livePhoto: livePhotos.length === 1 && imageUrls.length === 1 ? livePhotos[0] : undefined,
        },
      });
    } else {
      // 单图实况模式
      const imageUrl: string = body?.imageUrl ?? "";
      const musicUrl: string = body?.musicUrl ?? "";

      if (!imageUrl) {
        return NextResponse.json({ ok: false, error: "缺少 imageUrl" }, { status: 400 });
      }

      const videoUrl = await resolveLivePhotoVideoUrl(awemeId);

      if (!videoUrl) {
        return NextResponse.json({
          ok: true,
          data: {
            isLivePhoto: false,
            livePhoto: undefined,
          },
        });
      }

      return NextResponse.json({
        ok: true,
        data: {
          isLivePhoto: true,
          livePhoto: {
            imageUrl,
            videoUrl,
            musicUrl,
          },
        },
      });
    }
  } catch (err) {
    logger.error("parse-live-photo", "error:", err);
    return NextResponse.json({ ok: false, error: "实况照片解析失败" }, { status: 500 });
  }
}
