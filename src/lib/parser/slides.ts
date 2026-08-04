/**
 * 抖音混合图文（slides）解析。
 * 从原 parser.ts 抽取 parseSlides，依赖 extract.ts 纯函数与 live-photo-resolver。
 */

import { ParseError } from "./types";
import type { LivePhotoInfo, ParsedVideo } from "./types";
import { pickFirstUrl, normalizeUrl, formatNumber, pickBestImageUrl } from "./extract";
import { resolveLivePhotosForSlides } from "../live-photo-resolver";
import { logger } from "../logger";
import { fetchAwemeItem } from "./aweme-detail";

export async function parseSlides(
  awemeId: string,
  originalUrl: string,
  options?: { skipLivePhoto?: boolean }
): Promise<ParsedVideo> {
  // 1. 获取 aweme item（多源 fallback：SSR → a_bogus 签名 API）
  const item = await fetchAwemeItem(awemeId);
  if (!item) {
    throw new ParseError("混合图文数据获取失败，可能需要更新解析策略", "SLIDES_NO_DATA");
  }

  let desc = "";
  let authorName = "Unknown";
  let avatar = "";
  let musicUrl = "";
  let cover = "";
  const imageList: string[] = [];
  let stats: ParsedVideo["stats"] = {};

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
  const duration = formatNumber(music.duration) || undefined;

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
    // 原始链接：混合图文「复制链接」时使用，避免只复制首图
    originalUrl,
    // 两阶段优化：skipLivePhoto 时标记 pending，前端将异步调用 /api/parse-live-photo 探测实况
    livePhotoPending: options?.skipLivePhoto ? true : undefined,
    raw: { slides: true, originalUrl },
  };
}
