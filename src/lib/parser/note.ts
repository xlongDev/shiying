/**
 * 抖音普通视频 / 图文帖（note）解析。
 * 从原 parser.ts 抽取 parseDouyin，依赖 extract.ts 纯函数与 live-photo-resolver。
 */

import { ParseError } from "./types";
import type { ParsedVideo } from "./types";
import {
  extractUrl,
  normalizeUrl,
  pickFirstUrl,
  formatNumber,
  pickBestImageUrl,
  extractDouyinId,
  resolveShortLink,
  extractMusicFromSource,
  extractMusicMetaFromSource,
} from "./extract";
import { resolveLivePhotoVideoUrl } from "../live-photo-resolver";
import { parseSlides } from "./slides";
import { logger } from "../logger";
import { fetchAwemeItem } from "./aweme-detail";

export async function parseDouyin(
  rawUrl: string,
  options?: { skipLivePhoto?: boolean }
): Promise<ParsedVideo> {
  const url = extractUrl(rawUrl) || rawUrl;

  // 1. 解析短链
  let longUrl = url;
  if (url.includes("v.douyin.com") || url.includes("v.iesdouyin.com")) {
    try {
      longUrl = await resolveShortLink(url);
    } catch {
      throw new ParseError("短链解析失败，请稍后重试", "SHORT_LINK_FAILED");
    }
  }

  // 2. 提取 ID 和类型
  const idInfo = extractDouyinId(longUrl);
  if (!idInfo) {
    throw new ParseError("无法获取视频 ID，请检查链接", "NO_AWEME_ID");
  }
  const { id: awemeId, type: contentType } = idInfo;

  // 3. slides 类型：走特殊的解析路径
  // slides（混合图文）的 SSR 页面通常不含 _ROUTER_DATA，
  // 需要通过桌面版 douyin.com 页面 + 无头浏览器探测实况
  if (contentType === "slides") {
    return parseSlides(awemeId, longUrl, options);
  }

  // 3. 获取 aweme item（多源 fallback：SSR → a_bogus 签名 API → 浏览器兜底）
  const item = await fetchAwemeItem(awemeId);
  if (!item) {
    throw new ParseError("页面数据提取失败，可能接口已变更", "NO_ROUTER_DATA");
  }
  const video = (item.video ?? {}) as Record<string, unknown>;
  const author = (item.author ?? {}) as Record<string, unknown>;
  const stats = (item.statistics ?? {}) as Record<string, unknown>;
  const images = item.images as unknown[] | null;

  // 检测是否为图文帖子
  // 抖音的图集/图文帖子都会返回 images 数组，普通视频不会
  // 因此只要存在有效的图片列表，就判定为图文帖
  const hasImages = Array.isArray(images) && images.length > 0;
  const isImagePost = hasImages;

  // 视频地址（带水印）
  // 图文帖没有真实的视频流，video.play_addr 即使是 slideshow 模板也不可用
  // 因此图文帖的 videoUrl 置空，音频 100% 从 music.play_url 获取
  const playAddr = (video.play_addr ?? {}) as Record<string, unknown>;
  const watermarkUrl = pickFirstUrl(playAddr.url_list);

  // 无水印：将 playwm 替换为 play
  // 图文帖没有真实视频，videoUrl 置空
  const videoUrl = isImagePost
    ? ""
    : watermarkUrl
      ? watermarkUrl.replace("/playwm/", "/play/").replace("playwm", "play")
      : "";

  // 构造 snssdk play URL（用于普通视频的音频提取回退）
  // 图文帖没有 video_id，videoUrlPlay 同样置空
  const videoUrlPlay = isImagePost
    ? ""
    : (() => {
        const videoIdMatch = watermarkUrl?.match(/[?&]video_id=([a-z0-9]+)/i);
        return videoIdMatch
          ? `https://aweme.snssdk.com/aweme/v1/play/?video_id=${videoIdMatch[1]}&ratio=720p&line=0`
          : videoUrl;
      })();

  // 封面
  const videoCover = (video.cover ?? {}) as Record<string, unknown>;
  const cover =
    pickFirstUrl(videoCover.url_list) ||
    (hasImages && images ? pickBestImageUrl(images[0] as Record<string, unknown>) : "");

  // 头像
  const avatarThumb = (author.avatar_thumb ?? {}) as Record<string, unknown>;
  const avatarMedium = (author.avatar_medium ?? {}) as Record<string, unknown>;
  const avatar = pickFirstUrl(avatarThumb.url_list) || pickFirstUrl(avatarMedium.url_list);

  // 图片列表（图文帖子）
  const imageList: string[] = [];
  if (hasImages) {
    for (const img of images as unknown[]) {
      if (typeof img === "object" && img !== null) {
        const url = pickBestImageUrl(img as Record<string, unknown>);
        if (url) imageList.push(url);
      }
    }
  }

  // 音乐对象（提前声明，供时长计算和音频提取使用）
  const music = (item.music ?? {}) as Record<string, unknown>;

  // 音乐元信息（歌名 / 作者 / 封面），汽水音乐可解析出真实歌名-作者
  const musicMeta = extractMusicMetaFromSource(music);

  // 时长：iesdouyin 返回 video.duration 为毫秒，需转换为秒；
  // 图文帖常无 video 时长，但 music.duration 为秒，可作为兜底
  const rawDuration = formatNumber(video.duration);
  const rawMusicDuration = formatNumber(music.duration);
  const duration = rawDuration ? Math.round(rawDuration / 1000) : rawMusicDuration || undefined;

  // 音乐/音频地址 — 多路径提取真实音频 URL（extractMusicFromSource 已抽取至 extract.ts）

  // 判断帖子是否有背景音乐（music 对象存在且不是空对象或只有 cover 字段）
  const musicInfo = item.musicInfo as Record<string, unknown> | undefined;
  let musicUrl =
    extractMusicFromSource(music) || (musicInfo ? extractMusicFromSource(musicInfo) : "");

  // 注：原 iesdouyin iteminfo 签名 API 兜底（music 提取失败时回查完整 item）已废弃，
  // 该 API 现返回 status_code:11110(encrypt_data_miss)。SSR 的 _ROUTER_DATA 已含完整
  // music.play_url，extractMusicFromSource 足以覆盖，无需再回查失效签名接口。

  // 图文帖兜底：music.play_url 可能在 SSR 中为空（如汽水音乐等官方版权音乐），
  // 但 video.play_addr.uri 实际指向的是背景音乐文件（slideshow 音频），直接提取使用
  if (!musicUrl && isImagePost) {
    const playAddrUri = normalizeUrl((playAddr.uri as string) || "");
    if (playAddrUri && playAddrUri.startsWith("https://")) {
      musicUrl = playAddrUri;
    }
  }

  // hasMusic 判断：
  //   - 图文帖：必须有 musicUrl（独立音频文件）才能下载
  //   - 普通视频：有 musicUrl 直接下载，否则可从 videoUrl 提取音频
  const hasMusic = isImagePost ? !!musicUrl : !!(musicUrl || videoUrl);

  // 不再使用 snssdk play URL 作为兜底 — 该 URL 返回的是视频流而非音频

  // ---- 实况照片（LivePhoto）检测与资源提取 ----
  // 参考 QingZai 项目：抖音网页 SSR 通常不会直接暴露 live_photo 字段，
  // 但实况照片本质上都是「单图 + 动态短片」的图文帖。我们采用两条路径：
  //   1. 兼容路径：若 SSR 中存在 image_info.live_photo=true，直接提取 SSR 里的资源；
  //   2. 主路径：单图 note 通过桌面页面无头浏览器提取 douyinvod 动态短片 URL。
  //
  // 优化：当 skipLivePhoto=true 时，跳过无头浏览器解析（路径2），仅使用 SSR 数据（路径1）
  // 这样前端可以先快速拿到基础信息，再异步调用 /api/parse-live-photo 获取实况资源
  let isLivePhoto = false;
  let livePhoto: ParsedVideo["livePhoto"] = undefined;

  // 路径 1：SSR 中显式声明 live_photo（不受 skipLivePhoto 影响）
  if (isImagePost) {
    const imageInfo = (item.image_info ?? {}) as Record<string, unknown>;
    const livePhotoFlag = imageInfo.live_photo;

    if (livePhotoFlag === true || (typeof livePhotoFlag === "object" && livePhotoFlag !== null)) {
      isLivePhoto = true;

      const livePhotoInfo = (imageInfo.live_photo_info ??
        (typeof livePhotoFlag === "object" ? livePhotoFlag : null)) as Record<
        string,
        unknown
      > | null;
      const rootLivePhoto = (item.live_photo ?? {}) as Record<string, unknown>;

      const lpImageObj = (livePhotoInfo?.image ?? rootLivePhoto.image ?? {}) as Record<
        string,
        unknown
      >;
      const livePhotoImageUrl = pickFirstUrl((lpImageObj as Record<string, unknown>).url_list);

      const lpVideoObj = (livePhotoInfo?.video ?? rootLivePhoto.video ?? {}) as Record<
        string,
        unknown
      >;
      const livePhotoVideoUrl = pickFirstUrl((lpVideoObj as Record<string, unknown>).url_list);

      const livePhotoMusicUrl = musicUrl || "";

      if (livePhotoImageUrl && livePhotoVideoUrl) {
        livePhoto = {
          imageUrl: livePhotoImageUrl,
          videoUrl: livePhotoVideoUrl,
          musicUrl: livePhotoMusicUrl,
        };
      } else {
        isLivePhoto = false;
        logger.warn("parser", "检测到 live_photo 标记但无法提取完整资源，退化为普通图文");
      }
    }
  }

  // 路径 2：单图 note 尝试桌面页面解析实况动态短片
  // 当 SSR 没有 live_photo 字段时，这是识别实况照片的唯一可靠方式
  // skipLivePhoto=true 时跳过此路径，前端将异步调用 /api/parse-live-photo
  if (isImagePost && !isLivePhoto && imageList.length === 1 && !options?.skipLivePhoto) {
    try {
      const liveVideoUrl = await resolveLivePhotoVideoUrl(awemeId);
      if (liveVideoUrl) {
        isLivePhoto = true;
        livePhoto = {
          imageUrl: imageList[0],
          videoUrl: liveVideoUrl,
          musicUrl: musicUrl || "",
        };
      }
    } catch (err) {
      logger.warn("parser", "实况照片动态短片解析失败:", err);
    }
  }

  return {
    platform: "douyin",
    awemeId,
    desc: (item.desc as string) ?? "",
    author: {
      name: (author.nickname as string) ?? "Unknown",
      avatar,
      uid: author.uid as string | undefined,
    },
    cover,
    videoUrl,
    videoUrlWithWatermark: watermarkUrl || undefined,
    videoUrlPlay: videoUrlPlay || undefined,
    musicUrl: musicUrl || undefined,
    hasMusic,
    musicMeta: musicMeta || undefined,
    duration,
    stats: {
      likeCount: formatNumber(stats.digg_count ?? stats.diggCount),
      commentCount: formatNumber(stats.comment_count ?? stats.commentCount),
      shareCount: formatNumber(stats.share_count ?? stats.shareCount),
    },
    images: imageList.length > 0 ? imageList : undefined,
    isImagePost,
    contentType: isImagePost ? "note" : "video",
    isLivePhoto: isLivePhoto || undefined,
    livePhoto,
    // 原始链接：图文帖「复制链接」时使用，避免只复制首图
    originalUrl: longUrl,
    // 异步实况探测的 pending/background 标记统一由 /api/parse 路由根据内容类型决定
    // （slides 走骨架屏 pending；note 走静默 background），此处仅初始化字段。
    livePhotoPending: undefined,
    livePhotoBackground: undefined,
    raw: item,
  };
}
