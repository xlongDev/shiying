/**
 * 抖音混合图文（slides）解析。
 * 从原 parser.ts 抽取 parseSlides，依赖 extract.ts 纯函数与 live-photo-resolver。
 */

import { ParseError } from "./types";
import type { LivePhotoInfo, ParsedVideo } from "./types";
import {
  MOBILE_UA,
  pickFirstUrl,
  normalizeUrl,
  formatNumber,
  pickBestImageUrl,
} from "./extract";
import { resolveLivePhotosForSlides } from "../live-photo-resolver";
import { logger } from "../logger";

export async function parseSlides(
  awemeId: string,
  originalUrl: string,
  options?: { skipLivePhoto?: boolean }
): Promise<ParsedVideo> {
  // 1. 尝试通过 iesdouyin SSR 获取基础数据
  let desc = "";
  let authorName = "Unknown";
  let avatar = "";
  let musicUrl = "";
  let cover = "";
  const imageList: string[] = [];
  let stats: ParsedVideo["stats"] = {};
  let duration: number | undefined;

  // 尝试 SSR 获取
  const shareUrl = `https://www.iesdouyin.com/share/note/${awemeId}/`;
  const res = await fetch(shareUrl, {
    headers: {
      "user-agent": MOBILE_UA,
      accept: "text/html",
      "accept-language": "zh-CN,zh;q=0.9",
      referer: "https://www.douyin.com/",
    },
  });

  if (res.ok) {
    const html = await res.text();
    const dataMatch = html.match(/_ROUTER_DATA\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);

    if (dataMatch) {
      try {
        const jsonData = JSON.parse(dataMatch[1]) as Record<string, unknown>;
        const loaderData = (jsonData.loaderData ?? {}) as Record<string, unknown>;
        const loaderKeys = Object.keys(loaderData);
        // slides 的 loaderData key 可能是 note_(id)/page 或 slides_(id)/page
        const pageKey =
          loaderKeys.find((k) => k.includes("note_(id)")) ||
          loaderKeys.find((k) => k.includes("slides_(id)")) ||
          loaderKeys.find((k) => k.includes("video_(id)")) ||
          loaderKeys.find((k) => k.includes("note")) ||
          loaderKeys.find((k) => k.includes("slides")) ||
          loaderKeys.find((k) => k.includes("video"));
        const pageData = (
          pageKey ? (loaderData[pageKey] as Record<string, unknown>) : {}
        ) as Record<string, unknown>;
        const videoInfoRes = (pageData.videoInfoRes ?? pageData.videoInfo ?? {}) as Record<
          string,
          unknown
        >;
        const itemList = (videoInfoRes.item_list ?? []) as unknown[];

        if (itemList.length > 0) {
          const item = itemList[0] as Record<string, unknown>;
          const author = (item.author ?? {}) as Record<string, unknown>;
          const itemStats = (item.statistics ?? {}) as Record<string, unknown>;
          const music = (item.music ?? {}) as Record<string, unknown>;
          const images = item.images as unknown[] | null;

          desc = (item.desc as string) ?? "";
          authorName = (author.nickname as string) ?? "Unknown";
          const avatarThumb = (author.avatar_thumb ?? {}) as Record<string, unknown>;
          const avatarMedium = (author.avatar_medium ?? {}) as Record<string, unknown>;
          avatar = pickFirstUrl(avatarThumb.url_list) || pickFirstUrl(avatarMedium.url_list);

          stats = {
            likeCount: formatNumber(itemStats.digg_count ?? itemStats.diggCount),
            commentCount: formatNumber(itemStats.comment_count ?? itemStats.commentCount),
            shareCount: formatNumber(itemStats.share_count ?? itemStats.shareCount),
          };

          // 封面
          const video = (item.video ?? {}) as Record<string, unknown>;
          const videoCover = (video.cover ?? {}) as Record<string, unknown>;
          cover = pickFirstUrl(videoCover.url_list);

          // 音乐 — 提取逻辑与 note 类型一致，支持多种来源
          const musicPlayUrl = (music.play_url ?? {}) as Record<string, unknown>;
          musicUrl =
            pickFirstUrl(musicPlayUrl.url_list) ||
            normalizeUrl(typeof music.url === "string" ? music.url : "") ||
            normalizeUrl(typeof music.uri === "string" ? music.uri : "");

          // 图文帖兜底：SSR 中 music.play_url 可能为空（如汽水音乐等官方版权音乐）
          // 尝试从 video.play_addr 中提取音频 URI 作为降级方案
          if (!musicUrl) {
            const videoPlayAddr = (video.play_addr ?? {}) as Record<string, unknown>;
            const playAddrUri =
              typeof videoPlayAddr.uri === "string" ? normalizeUrl(videoPlayAddr.uri) : "";
            if (playAddrUri) {
              musicUrl = playAddrUri;
            }
          }

          // 图片
          if (Array.isArray(images) && images.length > 0) {
            for (const img of images) {
              if (typeof img === "object" && img !== null) {
                const url = pickBestImageUrl(img as Record<string, unknown>);
                if (url) imageList.push(url);
              }
            }
            if (!cover && imageList.length > 0) cover = imageList[0];
          }

          // 时长
          const rawMusicDuration = formatNumber(music.duration);
          duration = rawMusicDuration || undefined;
        }
      } catch (err) {
        logger.warn("slides", "SSR JSON 解析失败:", err);
      }
    }
  }

  // 2. 如果 SSR 没有数据，尝试通过桌面版 douyin.com 页面获取
  if (imageList.length === 0) {
    logger.warn("slides", "SSR 未获取到图片数据，尝试桌面版页面 fallback");
    // 对于 slides 类型，桌面版 www.douyin.com/note/{id} 可能也能渲染
    // 这里先抛出错误，让用户知道无法解析
    // 实际上混合图文的桌面版页面数据是通过客户端 API 获取的
    // 我们需要通过无头浏览器获取数据
  }

  if (imageList.length === 0) {
    throw new ParseError("混合图文数据获取失败，可能需要更新解析策略", "SLIDES_NO_DATA");
  }

  // 3. 对每张图片做实况探测
  // skipLivePhoto=true 时跳过无头浏览器探测，前端将异步调用 /api/parse-live-photo
  const livePhotos: LivePhotoInfo[] = [];
  if (!options?.skipLivePhoto) {
    try {
      const lives = await resolveLivePhotosForSlides(awemeId, imageList.length);
      for (const lp of lives) {
        livePhotos.push({
          imageUrl: lp.imageUrl || (imageList[lp.index] ?? ""),
          videoUrl: lp.videoUrl,
          musicUrl: musicUrl || "",
          index: lp.index,
        });
      }
    } catch (err) {
      logger.warn("slides", "混合实况探测失败:", err);
    }
  }

  // hasMusic 判断：
  //   - 图文帖（含 slides）：有 musicUrl 或有 awemeId（可动态获取音乐）都视为有音乐
  //   - 普通视频：必须有 musicUrl 或 videoUrl 才能下载/提取
  const hasMusic = !!musicUrl || true; // slides 图文帖总是尝试获取音乐（通过 awemeId 降级）

  return {
    platform: "douyin",
    awemeId,
    desc,
    author: {
      name: authorName,
      avatar,
    },
    cover,
    videoUrl: "", // slides 类型没有独立视频
    musicUrl: musicUrl || undefined,
    hasMusic,
    duration,
    stats,
    images: imageList.length > 0 ? imageList : undefined,
    isImagePost: true,
    contentType: "slides",
    // 混合实况照片标记
    isMixedLivePhoto: livePhotos.length > 0 || undefined,
    livePhotos: livePhotos.length > 0 ? livePhotos : undefined,
    // 单图实况兼容：如果所有图片都是实况（极少见），也标记为 isLivePhoto
    isLivePhoto: livePhotos.length > 0 && livePhotos.length === imageList.length ? true : undefined,
    livePhoto: livePhotos.length === 1 && imageList.length === 1 ? livePhotos[0] : undefined,
    // 两阶段优化：skipLivePhoto 时标记 pending，前端将异步调用 /api/parse-live-photo 探测实况
    livePhotoPending: options?.skipLivePhoto ? true : undefined,
    raw: { slides: true, originalUrl },
  };
}
