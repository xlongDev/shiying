import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

function normalizeUrl(u: string): string {
  if (!u) return "";
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  if (u.startsWith("//")) return `https:${u}`;
  return "";
}

function pickFirstUrl(list: unknown): string {
  const arr = Array.isArray(list) ? list : [];
  for (const item of arr) {
    if (typeof item === "string") {
      const normalized = normalizeUrl(item);
      if (normalized) return normalized;
    }
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const nested = obj.url_list as unknown[];
      if (Array.isArray(nested)) {
        for (const n of nested) {
          if (typeof n === "string") {
            const normalized = normalizeUrl(n);
            if (normalized) return normalized;
          }
        }
      }
      if (typeof obj.url === "string") {
        const normalized = normalizeUrl(obj.url as string);
        if (normalized) return normalized;
      }
      if (typeof obj.uri === "string") {
        const normalized = normalizeUrl(obj.uri as string);
        if (normalized) return normalized;
      }
    }
  }
  return "";
}

function extractMusicUrl(musicObj: unknown): string {
  if (!musicObj || typeof musicObj !== "object") return "";
  const m = musicObj as Record<string, unknown>;

  // play_url
  const playUrl = m.play_url;
  if (typeof playUrl === "string") return normalizeUrl(playUrl);
  if (playUrl && typeof playUrl === "object") {
    const p = playUrl as Record<string, unknown>;
    let url = pickFirstUrl(p.url_list);
    if (!url) url = normalizeUrl(typeof p.url === "string" ? p.url : "");
    if (!url) url = normalizeUrl(typeof p.uri === "string" ? p.uri : "");
    if (!url && typeof p.play_url === "string") {
      url = normalizeUrl(p.play_url as string);
    }
    if (url) return url;
  }

  // direct url / uri
  const directUrl = normalizeUrl(typeof m.url === "string" ? m.url : "");
  const directUri = normalizeUrl(typeof m.uri === "string" ? m.uri : "");
  if (directUrl) return directUrl;
  if (directUri) return directUri;

  return "";
}

/**
 * 动态获取音乐下载链接
 * 用法：GET /api/download-music?awemeId=xxx&filename=xxx
 *
 * 当 SSR 解析未提取到 musicUrl 时，通过 iesdouyin iteminfo API 动态获取
 * 适用于图文帖等场景
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const awemeId = searchParams.get("awemeId");
  const filename = searchParams.get("filename") || "music.m4a";

  if (!awemeId) {
    return NextResponse.json({ ok: false, error: "缺少 awemeId 参数" }, { status: 400 });
  }

  // 1. 调用 iesdouyin iteminfo API 获取音乐 URL
  let musicUrl = "";
  try {
    const apiRes = await fetch(
      `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${awemeId}`,
      {
        headers: {
          "user-agent": MOBILE_UA,
          referer: "https://www.iesdouyin.com/",
        },
      }
    );

    if (!apiRes.ok) {
      return NextResponse.json(
        { ok: false, error: `获取音频信息失败 (API ${apiRes.status})` },
        { status: 502 }
      );
    }

    const json = (await apiRes.json()) as Record<string, unknown>;
    const itemList = json.item_list as unknown[];

    if (!Array.isArray(itemList) || itemList.length === 0) {
      return NextResponse.json({ ok: false, error: "该视频可能已被删除" }, { status: 404 });
    }

    const item = itemList[0] as Record<string, unknown>;
    musicUrl = extractMusicUrl(item.music) || extractMusicUrl(item.musicInfo);

    if (!musicUrl) {
      return NextResponse.json({ ok: false, error: "未找到可用的音频文件" }, { status: 404 });
    }
  } catch (err) {
    logger.error("download-music", "API error:", err);
    return NextResponse.json({ ok: false, error: "获取音频信息失败" }, { status: 500 });
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
