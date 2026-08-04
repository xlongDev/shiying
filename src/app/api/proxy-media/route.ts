import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/rate-limit-guard";
import { isAllowedTarget } from "@/lib/ssrf";
import { buildUpstreamHeaders } from "@/lib/cdn";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 媒体代理下载：音频/图片跨域中转
 * 用法：GET /api/proxy-media?url=xxx&filename=xxx
 *
 * 安全加固：
 *   - SSRF：仅允许代理到白名单内的抖音 / TikTok CDN 主机（且解析 IP 非内网）。
 *   - 超时：上游 fetch 60s 超时，超时返回 504。
 *   - 体积：上游 content-length 超过 50 MiB 返回 413。
 *   - 响应头：Cache-Control 改为 public, max-age=3600，新增 X-Content-Type-Options: nosniff。
 */
/** 上游最大响应体积：图片 / 音频 50 MiB。 */
const MAX_UPSTREAM_BYTES = 52428800;
/** 上游 fetch 超时（毫秒）。 */
const UPSTREAM_TIMEOUT_MS = 60000;

export async function GET(req: NextRequest) {
  // 图片代理放宽为 120 次/分钟，避免 100 张图文帖集中预览时误触发服务端限流。
  const blocked = await guardRateLimit(req, "proxy-media", 120, 60_000);
  if (blocked) return blocked;

  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get("url");
  const filename = searchParams.get("filename") || "media";

  if (!targetUrl) {
    return NextResponse.json({ ok: false, error: "缺少 url 参数" }, { status: 400 });
  }

  // SSRF：只允许代理到白名单 CDN 主机，且解析出的 IP 非内网。
  if (!(await isAllowedTarget(targetUrl))) {
    return Response.json({ error: "forbidden target" }, { status: 403 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    // 抖音图片 CDN 需要 Referer 才能访问（平台判断与 Referer 统一由 cdn.ts 提供）
    const headers = buildUpstreamHeaders(targetUrl);

    // 对于 snssdk play URL，先 probe 获取重定向地址
    let finalUrl = targetUrl;
    if (targetUrl.includes("snssdk") && targetUrl.includes("/play")) {
      try {
        const probe = await fetch(targetUrl, {
          headers,
          redirect: "manual",
          signal: controller.signal,
        });
        if (probe.status >= 300 && probe.status < 400) {
          const loc = probe.headers.get("location");
          if (loc) finalUrl = new URL(loc, targetUrl).toString();
        }
      } catch (e) {
        logger.warn("proxy-media", "play URL probe failed, fallback to original:", e);
      }
    }

    // 最终地址若来自 3xx 重定向（可能与原始主机不同），再次做 SSRF 校验。
    if (finalUrl !== targetUrl && !(await isAllowedTarget(finalUrl))) {
      return Response.json({ error: "forbidden target" }, { status: 403 });
    }

    // 下载最终内容
    const upstream = await fetch(finalUrl, {
      headers: buildUpstreamHeaders(finalUrl),
      redirect: "follow",
      signal: controller.signal,
    });

    if (!upstream.ok || !upstream.body) {
      logger.error(
        "proxy-media",
        `upstream failed: ${upstream.status} for ${finalUrl.substring(0, 120)}`
      );
      // 上游返回 429 时把 Retry-After 透传给浏览器，便于前端自动重试。
      if (upstream.status === 429) {
        const retryAfter = upstream.headers.get("retry-after") || "5";
        return NextResponse.json(
          { ok: false, error: "上游请求过于频繁，请稍后重试", code: "UPSTREAM_RATE_LIMITED" },
          {
            status: 429,
            headers: { "Retry-After": retryAfter },
          }
        );
      }
      return NextResponse.json(
        { ok: false, error: `上游请求失败：HTTP ${upstream.status}` },
        { status: 502 }
      );
    }

    // 体积上限：仅在服务端给出 content-length 时校验，避免代理超大响应。
    const contentLength = upstream.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_UPSTREAM_BYTES) {
      return NextResponse.json({ ok: false, error: "上游响应过大" }, { status: 413 });
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";

    const responseHeaders = new Headers({
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    });
    if (contentLength) responseHeaders.set("Content-Length", contentLength);

    return new NextResponse(upstream.body, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ ok: false, error: "上游请求超时" }, { status: 504 });
    }
    logger.error("proxy-media", "error:", err);
    return NextResponse.json({ ok: false, error: "代理下载失败" }, { status: 500 });
  } finally {
    clearTimeout(timer);
  }
}
