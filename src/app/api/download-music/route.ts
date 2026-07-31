import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { isAllowedTarget } from "@/lib/ssrf";
import { extractMusicFromSource } from "@/lib/parser/extract";
import { fetchAwemeItemViaSsr } from "@/lib/live-photo-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

/**
 * 动态获取音乐下载链接
 * 用法：GET /api/download-music?awemeId=xxx&filename=xxx
 *
 * 复用主解析的 SSR 方案（移动端 UA 抓取 iesdouyin 分享页 _ROUTER_DATA）提取 music.play_url，
 * 不再依赖 iesdouyin iteminfo 签名 API（现返回 11110 encrypt_data_miss，已废弃）。
 *
 * 安全加固：musicUrl 来自上游 SSR 响应，下游 fetch 前仍经 isAllowedTarget
 * 校验白名单 + 非内网 IP，与 proxy 系列路由统一收口。
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const awemeId = searchParams.get("awemeId");
  const filename = searchParams.get("filename") || "music.m4a";

  if (!awemeId) {
    return NextResponse.json({ ok: false, error: "缺少 awemeId 参数" }, { status: 400 });
  }

  // 1. 通过 SSR 分享页获取 aweme item，提取音乐 URL（与 note 主解析同源）
  let musicUrl = "";
  try {
    const item = await fetchAwemeItemViaSsr(awemeId);
    if (item) {
      musicUrl = extractMusicFromSource(item.music) || extractMusicFromSource(item.musicInfo);
    }
  } catch (err) {
    logger.error("download-music", "SSR 解析失败:", err);
  }

  if (!musicUrl) {
    return NextResponse.json({ ok: false, error: "未找到可用的音频文件" }, { status: 404 });
  }

  // SSRF：musicUrl 来自上游 SSR 响应，下游 fetch 前仍须校验白名单 + 非内网 IP，统一收口。
  if (!(await isAllowedTarget(musicUrl))) {
    logger.error("download-music", `blocked non-whitelisted URL: ${musicUrl.substring(0, 120)}`);
    return NextResponse.json({ ok: false, error: "音频地址不合法" }, { status: 403 });
  }

  // 2. 代理下载音频文件
  try {
    const upstream = await fetch(musicUrl, {
      headers: {
        "user-agent": MOBILE_UA,
        accept: "*/*",
        referer: "https://www.douyin.com/",
      },
      redirect: "follow",
    });

    if (!upstream.ok || !upstream.body) {
      logger.error(
        "download-music",
        `upstream failed: ${upstream.status} for ${musicUrl.substring(0, 120)}`
      );
      return NextResponse.json(
        { ok: false, error: `音频下载失败：HTTP ${upstream.status}` },
        { status: 502 }
      );
    }

    const contentType = upstream.headers.get("content-type") ?? "audio/mp4";
    const contentLength = upstream.headers.get("content-length");

    const headers = new Headers({
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    if (contentLength) headers.set("Content-Length", contentLength);

    return new NextResponse(upstream.body, {
      status: 200,
      headers,
    });
  } catch (err) {
    logger.error("download-music", "proxy error:", err);
    return NextResponse.json({ ok: false, error: "音频下载失败" }, { status: 500 });
  }
}
