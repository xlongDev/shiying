import { NextRequest, NextResponse } from "next/server";
import { parseVideo, ParseError } from "@/lib/parser";
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
    // - note 单图：与 slides 同处理（骨架屏 + 重试）
    // - note 多图：静默后台探测（livePhotoBackground），仅找到实况时才展示实况 UI，
    //   探测失败/无实则静默降级为普通图文，不展示「探测未完成」面板，避免误报。
    //
    // 深链（modal_id / aweme_id / item_ids）属于「类型未知」的分享，
    // 常常就是实况照片帖（单图 or 多图混合），但历史上被当成普通 video、
    // 多图时又走了「静默后台探测」——既不可见、又会在无头探测偶发失败时静默降级，
    // 导致用户感知「明明有实况却不探测」。因此对这类深链强制使用「可见的探测中」态。
    const isAmbiguousDeepLink = /[?&](?:modal_id|aweme_id|item_ids)=(\d+)/.test(url);

    if (skipLivePhoto && !result.isLivePhoto && result.isImagePost) {
      if (result.contentType === "slides" || isAmbiguousDeepLink) {
        result.livePhotoPending = true;
      } else if (result.contentType === "note") {
        const imageCount = result.images?.length ?? 0;
        if (imageCount === 1) {
          result.livePhotoPending = true;
        } else {
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
