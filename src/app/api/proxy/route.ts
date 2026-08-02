import { NextRequest, NextResponse } from "next/server";
import { isAllowedTarget } from "@/lib/ssrf";
import { buildUpstreamHeaders } from "@/lib/cdn";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 视频/图片/音乐代理下载：解决跨域问题。
 * 对于 snssdk play URL，先 probe 获取重定向地址，再下载 CDN 内容。
 *
 * 安全加固：
 *   - SSRF：仅允许代理到白名单内的抖音 / TikTok CDN 主机（且解析 IP 非内网）。
 *   - 超时：上游 fetch 30s 超时，超时返回 504。
 *   - 体积：上游 content-length 超过 1 GiB 返回 413。
 *   - 响应头：保持 no-store，新增 X-Content-Type-Options: nosniff。
 */
/** 上游最大响应体积：视频 / 音频下载 1 GiB。 */
const MAX_UPSTREAM_BYTES = 1073741824;
/** 上游 fetch 超时（毫秒）。 */
const UPSTREAM_TIMEOUT_MS = 30000;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get("url");
  const filename = searchParams.get("filename") || "download";

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
    // 第一步：如果是 snssdk play URL，先获取重定向地址
    let finalUrl = targetUrl;
    if (targetUrl.includes("snssdk") && targetUrl.includes("/play/")) {
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
      } catch {
        // ignore, use original URL
      }
    }

    // 最终地址若来自 3xx 重定向（可能与原始主机不同），再次做 SSRF 校验。
    if (finalUrl !== targetUrl && !(await isAllowedTarget(finalUrl))) {
      return Response.json({ error: "forbidden target" }, { status: 403 });
    }

    // 第二步：下载最终内容（使用 redirect: follow 让 fetch 自动处理）
    const upstream = await fetch(finalUrl, {
      headers: buildUpstreamHeaders(finalUrl),
      redirect: "follow",
      signal: controller.signal,
    });

    if (!upstream.ok || !upstream.body) {
      logger.error(
        "proxy",
        `upstream failed: ${upstream.status} for ${finalUrl.substring(0, 120)}`
      );
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
      "Cache-Control": "no-store",
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
    logger.error("proxy", "error:", err);
    return NextResponse.json({ ok: false, error: "代理下载失败" }, { status: 500 });
  } finally {
    clearTimeout(timer);
  }
}
