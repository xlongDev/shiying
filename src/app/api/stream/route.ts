import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/rate-limit-guard";
import { isAllowedTarget } from "@/lib/ssrf";
import { buildUpstreamHeaders } from "@/lib/cdn";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 视频流代理：用于在线预览（不触发下载）
 * 用法：GET /api/stream?url=xxx
 *
 * 安全加固：
 *   - SSRF：仅允许代理到白名单内的抖音 / TikTok CDN 主机（且解析 IP 非内网）。
 *   - 超时：上游 fetch 30s 超时，超时返回 504。
 *   - 体积：上游 content-length 超过 1 GiB 返回 413。
 *   - 响应头：保持 no-store，新增 X-Content-Type-Options: nosniff。
 *   - Range：透传客户端 Range 请求头；上游支持范围请求时返回 206 + Content-Range，
 *     否则回退为 200 全量返回。
 */
/** 上游最大响应体积：视频 1 GiB。 */
const MAX_UPSTREAM_BYTES = 1073741824;
/** 上游 fetch 超时（毫秒）。 */
const UPSTREAM_TIMEOUT_MS = 30000;

export async function GET(req: NextRequest) {
  const blocked = await guardRateLimit(req, "stream", 60, 60_000);
  if (blocked) return blocked;

  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get("url");

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
    // 对于 snssdk play URL，先 probe 获取重定向地址
    let finalUrl = targetUrl;
    if (targetUrl.includes("snssdk") && targetUrl.includes("/play")) {
      try {
        const probe = await fetch(targetUrl, {
          headers: buildUpstreamHeaders(targetUrl),
          redirect: "manual",
          signal: controller.signal,
        });
        if (probe.status >= 300 && probe.status < 400) {
          const loc = probe.headers.get("location");
          if (loc) finalUrl = new URL(loc, targetUrl).toString();
        }
      } catch (e) {
        logger.warn("stream", "play URL probe failed, fallback to original:", e);
      }
    }

    // 最终地址若来自 3xx 重定向（可能与原始主机不同），再次做 SSRF 校验。
    if (finalUrl !== targetUrl && !(await isAllowedTarget(finalUrl))) {
      return Response.json({ error: "forbidden target" }, { status: 403 });
    }

    // 透传客户端 Range 请求头，支持浏览器流式拖动。
    const upstreamHeaders = buildUpstreamHeaders(finalUrl);
    const range = req.headers.get("range");
    if (range) upstreamHeaders["range"] = range;

    const upstream = await fetch(finalUrl, {
      headers: upstreamHeaders,
      redirect: "follow",
      signal: controller.signal,
    });

    if (!upstream.ok || !upstream.body) {
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

    const isRangeResponse = upstream.status === 206;
    const contentType = upstream.headers.get("content-type") ?? "video/mp4";

    // 使用 inline 而非 attachment，允许浏览器在线播放
    const responseHeaders = new Headers({
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    });
    // 范围请求相关响应头透传；上游不支持时仍声明 bytes（与原实现一致）。
    const acceptRanges = upstream.headers.get("accept-ranges");
    responseHeaders.set("Accept-Ranges", acceptRanges ?? "bytes");
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) responseHeaders.set("Content-Range", contentRange);
    if (contentLength) responseHeaders.set("Content-Length", contentLength);

    return new NextResponse(upstream.body, {
      status: isRangeResponse ? 206 : 200,
      headers: responseHeaders,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ ok: false, error: "上游请求超时" }, { status: 504 });
    }
    logger.error("stream", "error:", err);
    return NextResponse.json({ ok: false, error: "流代理失败" }, { status: 500 });
  } finally {
    clearTimeout(timer);
  }
}
