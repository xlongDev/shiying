/**
 * 抖音无水印视频/图集解析器
 *
 * 参考 QingZai 项目：
 * - iOS UA 请求 iesdouyin SSR 分享页
 * - 从 _ROUTER_DATA 提取视频/图片信息
 * - playwm → play 替换获取无水印视频
 */

import { resolveLivePhotoVideoUrl, resolveLivePhotosForSlides } from "./live-photo-resolver";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

export interface LivePhotoInfo {
  /** 静态高清原图 CDN URL */
  imageUrl: string;
  /** 无水印动态短片 CDN URL（2-4 秒 MP4） */
  videoUrl: string;
  /** BGM 背景音乐 CDN URL */
  musicUrl: string;
  /** 该实况照片在图片列表中的索引（混合图文场景） */
  index?: number;
}

export interface ParsedVideo {
  platform: "douyin";
  awemeId: string;
  desc: string;
  author: { name: string; avatar: string; uid?: string };
  cover: string;
  videoUrl: string;
  videoUrlWithWatermark?: string;
  videoUrlPlay?: string;
  musicUrl?: string;
  hasMusic?: boolean;
  duration?: number;
  stats?: { likeCount?: number; commentCount?: number; shareCount?: number };
  images?: string[];
  isImagePost?: boolean;
  /** 内容类型：video 普通视频，note 图文帖，slides 混合图文 */
  contentType?: "video" | "note" | "slides";
  /** 是否为实况照片帖子（单图实况） */
  isLivePhoto?: boolean;
  /** 单图实况照片三套资源（仅单图实况帖存在） */
  livePhoto?: LivePhotoInfo;
  /** 是否为混合图文+实况帖子（slides 类型，含普通图+实况图） */
  isMixedLivePhoto?: boolean;
  /** 混合图文中的多实况照片数组（仅 slides 类型存在） */
  livePhotos?: LivePhotoInfo[];
  /** 实况照片资源是否仍在异步解析中（前端用于骨架屏显示） */
  livePhotoPending?: boolean;
  /**
   * 实况照片后台静默探测标记。
   * 与 livePhotoPending 的区别：后台探测不展示「探测中」骨架屏、探测失败也不展示
   * 「探测未完成」重试面板，仅在确实找到实况资源时才展示实况 UI。
   * 用于普通图文帖（含多图 note），避免对不含实况的普通帖子误报。
   */
  livePhotoBackground?: boolean;
  /** 实况照片异步探测是否已尝试但仍未获取到（前端用于展示「重试」入口，避免静默降级为普通图片） */
  livePhotoFailed?: boolean;
  raw?: unknown;
}

export class ParseError extends Error {
  constructor(
    message: string,
    public code: string = "PARSE_ERROR"
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */

export function extractUrl(text: string): string | null {
  const trimmed = text.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const match = trimmed.match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0] : null;
}

/**
 * 标准化 URL：补全协议相对 URL，返回合法的 https URL
 */
export function normalizeUrl(u: string): string {
  if (!u) return "";
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  if (u.startsWith("//")) return `https:${u}`;
  return "";
}

/**
 * 从 Douyin url_list 数组中提取第一个有效 URL
 * Douyin 的 url_list 元素可能是：
 *   1. 字符串: "https://xxx" / "//xxx"（协议相对）
 *   2. 对象（嵌套 url_list）: {uri: "...", url_list: ["https://xxx"]}
 *   3. 对象（直接 url）: {url: "https://xxx"}
 * 兼容所有格式
 */
export function pickFirstUrl(list: unknown): string {
  const arr = Array.isArray(list) ? list : [];
  for (const item of arr) {
    // 形式 1：直接字符串（含协议相对 URL）
    if (typeof item === "string") {
      const normalized = normalizeUrl(item);
      if (normalized) return normalized;
    }
    // 形式 2：对象
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;

      // 2a: 嵌套 url_list 数组
      const nested = obj.url_list as unknown[];
      if (Array.isArray(nested)) {
        for (const n of nested) {
          if (typeof n === "string") {
            const normalized = normalizeUrl(n);
            if (normalized) return normalized;
          }
        }
      }

      // 2b: 直接 url 字段
      if (typeof obj.url === "string") {
        const normalized = normalizeUrl(obj.url as string);
        if (normalized) return normalized;
      }

      // 2c: uri 字段（douyin 常用，可能为协议相对格式）
      if (typeof obj.uri === "string") {
        const normalized = normalizeUrl(obj.uri as string);
        if (normalized) return normalized;
      }
    }
  }
  return "";
}

export function formatNumber(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return isNaN(n) ? undefined : n;
  }
  return undefined;
}

/**
 * 从图片对象中提取最佳无水印 URL
 */
export function pickBestImageUrl(imgObj: Record<string, unknown>): string {
  const urlList = imgObj.url_list as unknown[];
  if (Array.isArray(urlList)) {
    const best = urlList.find((u) => typeof u === "string" && u.includes("tplv-dy-aweme-images"));
    if (best && typeof best === "string") return best;
    const first = urlList.find((u) => typeof u === "string");
    if (first && typeof first === "string") return first;
  }

  const downloadList = imgObj.download_url_list as unknown[];
  if (Array.isArray(downloadList)) {
    const clean = downloadList.find((u) => typeof u === "string" && !u.includes("water-v2"));
    if (clean && typeof clean === "string") return clean;
  }

  return "";
}

/* ------------------------------------------------------------------ */
/* 抖音解析                                                            */
/* ------------------------------------------------------------------ */

async function resolveShortLink(url: string): Promise<string> {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "user-agent": MOBILE_UA,
      accept: "text/html",
    },
  });
  return res.url;
}

export function extractDouyinId(
  url: string
): { id: string; type: "video" | "note" | "slides" } | null {
  const patterns: { regex: RegExp; type: "video" | "note" | "slides" }[] = [
    { regex: /\/share\/slides\/(\d+)/, type: "slides" },
    { regex: /\/share\/video\/(\d+)/, type: "video" },
    { regex: /\/share\/note\/(\d+)/, type: "note" },
    { regex: /\/video\/(\d+)/, type: "video" },
    { regex: /\/note\/(\d+)/, type: "note" },
    { regex: /\/slides\/(\d+)/, type: "slides" },
    { regex: /[?&]modal_id=(\d+)/, type: "video" },
    { regex: /[?&]aweme_id=(\d+)/, type: "video" },
    { regex: /[?&]item_ids=(\d+)/, type: "video" },
  ];
  for (const p of patterns) {
    const m = url.match(p.regex);
    if (m) return { id: m[1], type: p.type };
  }
  return null;
}

async function parseDouyin(
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

  // 3. 请求 iesdouyin 分享页
  const shareUrl =
    contentType === "note"
      ? `https://www.iesdouyin.com/share/note/${awemeId}/`
      : `https://www.iesdouyin.com/share/video/${awemeId}/`;
  const res = await fetch(shareUrl, {
    headers: {
      "user-agent": MOBILE_UA,
      accept: "text/html",
      "accept-language": "zh-CN,zh;q=0.9",
      referer: "https://www.douyin.com/",
    },
  });

  if (!res.ok) {
    throw new ParseError(`获取分享页失败 (HTTP ${res.status})`, "SHARE_PAGE_FAILED");
  }

  const html = await res.text();

  // 4. 提取 _ROUTER_DATA
  const dataMatch = html.match(/_ROUTER_DATA\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
  if (!dataMatch) {
    throw new ParseError("页面数据提取失败，可能接口已变更", "NO_ROUTER_DATA");
  }

  let jsonData: Record<string, unknown>;
  try {
    jsonData = JSON.parse(dataMatch[1]);
  } catch {
    throw new ParseError("解析 JSON 数据失败", "JSON_PARSE_ERROR");
  }

  // 5. 查找 item_list
  // 兼容 video 和 note 两种页面：loaderData key 可能为 video_(id)/page 或 note_(id)/page
  const loaderData = (jsonData.loaderData ?? {}) as Record<string, unknown>;
  const loaderKeys = Object.keys(loaderData);
  const pageKey =
    loaderKeys.find((k) => k.includes("video_(id)")) ||
    loaderKeys.find((k) => k.includes("note_(id)")) ||
    loaderKeys.find((k) => k.includes("video")) ||
    loaderKeys.find((k) => k.includes("note"));
  const pageData = (pageKey ? (loaderData[pageKey] as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
  const videoInfoRes = (pageData?.videoInfoRes ?? pageData?.videoInfo ?? {}) as Record<
    string,
    unknown
  >;
  const itemList = (videoInfoRes.item_list ?? []) as unknown[];

  if (itemList.length === 0) {
    throw new ParseError("视频可能已被删除或不可访问", "NO_ITEM");
  }

  const item = itemList[0] as Record<string, unknown>;
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

  // 时长：iesdouyin 返回 video.duration 为毫秒，需转换为秒；
  // 图文帖常无 video 时长，但 music.duration 为秒，可作为兜底
  const rawDuration = formatNumber(video.duration);
  const rawMusicDuration = formatNumber(music.duration);
  const duration = rawDuration ? Math.round(rawDuration / 1000) : rawMusicDuration || undefined;

  // 音乐/音频地址 — 多路径提取真实音频 URL
  function extractMusicFromSource(src: unknown): string {
    if (!src || typeof src !== "object") return "";
    const m = src as Record<string, unknown>;

    // 1) music.play_url -> 对象或字符串
    const playUrl = m.play_url;
    if (typeof playUrl === "string") {
      return normalizeUrl(playUrl);
    }
    if (playUrl && typeof playUrl === "object") {
      const p = playUrl as Record<string, unknown>;
      let url = pickFirstUrl(p.url_list);
      if (!url) url = normalizeUrl(typeof p.url === "string" ? p.url : "");
      if (!url) url = normalizeUrl(typeof p.uri === "string" ? p.uri : "");
      // 极少数情况：play_url 内部还有嵌套 play_url
      if (!url && p.play_url && typeof p.play_url === "string") {
        url = normalizeUrl(p.play_url as string);
      }
      if (url) return url;
    }

    // 2) music.url / music.uri
    const directUrl = normalizeUrl(typeof m.url === "string" ? m.url : "");
    const directUri = normalizeUrl(typeof m.uri === "string" ? m.uri : "");
    if (directUrl) return directUrl;
    if (directUri) return directUri;

    return "";
  }

  // 判断帖子是否有背景音乐（music 对象存在且不是空对象或只有 cover 字段）
  const musicInfo = item.musicInfo as Record<string, unknown> | undefined;
  let musicUrl =
    extractMusicFromSource(music) || (musicInfo ? extractMusicFromSource(musicInfo) : "");

  // API 兜底：调用 iesdouyin iteminfo 获取完整 music 数据
  // 注意：此 API 可能返回 status_code: 11110（反爬），仅在 SSR 数据中 music.play_url
  // 非空但因格式原因未提取到 URL 时才走这里（play_url 存在但 url_list 为对象数组等边界情况）
  if (!musicUrl) {
    // 先判断 music.play_url 是否实际存在数据（非空对象/空数组）
    const musicPlayUrl = (music.play_url ?? {}) as Record<string, unknown>;
    const playUrlExists =
      musicPlayUrl &&
      typeof musicPlayUrl === "object" &&
      ((Array.isArray(musicPlayUrl.url_list) && (musicPlayUrl.url_list as unknown[]).length > 0) ||
        (typeof musicPlayUrl.url === "string" && (musicPlayUrl.url as string).length > 0) ||
        (typeof musicPlayUrl.uri === "string" && (musicPlayUrl.uri as string).length > 0));

    if (playUrlExists) {
      try {
        const infoRes = await fetch(
          `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${awemeId}`,
          { headers: { "user-agent": MOBILE_UA, referer: "https://www.iesdouyin.com/" } }
        );
        if (infoRes.ok) {
          const infoJson = (await infoRes.json()) as Record<string, unknown>;
          const infoList = infoJson.item_list as unknown[];
          if (Array.isArray(infoList) && infoList.length > 0) {
            const infoItem = infoList[0] as Record<string, unknown>;
            musicUrl =
              extractMusicFromSource(infoItem.music) || extractMusicFromSource(infoItem.musicInfo);
          }
        }
      } catch {
        // API 可能已失效，忽略
      }
    }
  }

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
  //   2. 主路径：单图 note 通过桌面版 note 页面无头浏览器提取 douyinvod 动态短片 URL。
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
        console.warn("[parser] 检测到 live_photo 标记但无法提取完整资源，退化为普通图文");
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
      console.warn("[parser] 实况照片动态短片解析失败:", err);
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
    // 异步实况探测的 pending/background 标记统一由 /api/parse 路由根据内容类型决定
    // （slides 走骨架屏 pending；note 走静默 background），此处仅初始化字段。
    livePhotoPending: undefined,
    livePhotoBackground: undefined,
    raw: item,
  };
}

/* ------------------------------------------------------------------ */
/* Slides（混合图文）解析                                               */
/* ------------------------------------------------------------------ */

/**
 * 解析 slides 类型链接（混合图文+实况照片）
 *
 * slides 类型的特点：
 * 1. 短链解析后 URL 为 /share/slides/{id}/
 * 2. iesdouyin SSR 页面可能不含 _ROUTER_DATA（需 fallback）
 * 3. 图片中某些是实况照片（hover 时触发 douyinvod 视频请求），某些是普通图片
 * 4. 实况识别只能通过无头浏览器在桌面版页面逐一 hover 探测
 */
async function parseSlides(
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
        console.warn("[slides] SSR JSON 解析失败:", err);
      }
    }
  }

  // 2. 如果 SSR 没有数据，尝试通过桌面版 douyin.com 页面获取
  if (imageList.length === 0) {
    console.warn("[slides] SSR 未获取到图片数据，尝试桌面版页面 fallback");
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
      console.warn("[slides] 混合实况探测失败:", err);
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

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

export function detectPlatform(url: string): "douyin" | null {
  const u = url.toLowerCase();
  if (u.includes("douyin.com") || u.includes("iesdouyin.com") || u.includes("v.douyin.com")) {
    return "douyin";
  }
  return null;
}

export async function parseVideo(
  rawUrl: string,
  options?: { skipLivePhoto?: boolean }
): Promise<ParsedVideo> {
  const url = extractUrl(rawUrl);
  if (!url) {
    throw new ParseError("请输入视频链接", "EMPTY_URL");
  }

  const platform = detectPlatform(url);
  if (!platform) {
    throw new ParseError("暂不支持的链接，请输入抖音分享链接", "UNSUPPORTED_PLATFORM");
  }

  return parseDouyin(rawUrl, options);
}
