/**
 * 抖音解析 —— 纯工具函数层（无 React / 无网络副作用之外的依赖）。
 * 从原 parser.ts 抽取，便于单测与复用。
 */

export const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

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

export async function resolveShortLink(url: string): Promise<string> {
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

/**
 * 从 music 对象中提取真实音频 URL（多路径兜底）。
 * 原内联于 parseDouyin，抽取为共享纯函数。
 */
export function extractMusicFromSource(src: unknown): string {
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

/**
 * 抖音音乐元信息（歌名 + 作者 + 封面）。
 *
 * 抖音对汽水音乐（版权音乐）/ 原声，会把真实歌名与作者嵌进 `music.title` 的括号里，例如：
 *   `@上传者创作的原声一上传者（原声中的歌曲：真实歌名-真实作者）`
 * 命中该模式时提取出真实歌名/作者；未命中（普通用户原声）则回退为 music.title / music.author 原样展示。
 */
export interface MusicMeta {
  /** 展示用歌曲名（汽水音乐提取真实歌名，否则 music.title） */
  title: string;
  /** 作者/演唱者（汽水音乐提取真实作者，否则 music.author） */
  author: string;
  /** 音乐封面图 URL（如有） */
  cover?: string;
  /** 是否为用户原声（未提取到真实歌曲名） */
  isOriginalSound?: boolean;
}

export function extractMusicMetaFromSource(src: unknown): MusicMeta | null {
  if (!src || typeof src !== "object") return null;
  const m = src as Record<string, unknown>;
  const rawTitle = typeof m.title === "string" ? m.title : "";
  const rawAuthor = typeof m.author === "string" ? m.author : "";
  if (!rawTitle && !rawAuthor) return null;

  let title = rawTitle;
  let author = rawAuthor;

  // 汽水音乐 / 原声：title 形如
  //   @上传者创作的原声一上传者（原声中的歌曲：真实歌名-真实作者）
  // 提取括号中的真实歌名（group1）与作者（group2）
  const qishui = rawTitle.match(/原声中的歌曲[：:]\s*(.+?)\s*[-—]\s*(.+?)\s*[）)]/);
  const isOriginalSound = !qishui;
  if (qishui) {
    title = qishui[1].trim();
    author = qishui[2].trim();
  }

  const meta: MusicMeta = {
    title: title || rawAuthor || "未知音乐",
    author,
    isOriginalSound,
  };

  // 封面：cover_large / cover_hd / cover_medium / cover_thumb 为对象 { url_list: [...] }
  const coverRaw = m.cover_large ?? m.cover_hd ?? m.cover_medium ?? m.cover_thumb ?? null;
  if (coverRaw && typeof coverRaw === "object") {
    const c = coverRaw as Record<string, unknown>;
    const url = pickFirstUrl(c.url_list) || normalizeUrl(typeof c.url === "string" ? c.url : "");
    if (url) meta.cover = url;
  } else if (typeof coverRaw === "string") {
    const url = normalizeUrl(coverRaw);
    if (url) meta.cover = url;
  }

  return meta;
}

/**
 * 从 HTML 中提取 _ROUTER_DATA / window._ROUTER_DATA 的 JSON 字符串。
 * 使用大括号深度匹配，比惰性正则更稳健，可处理超大嵌套 JSON。
 */
export function extractRouterData(html: string): string | null {
  const markers = ["window._ROUTER_DATA", "_ROUTER_DATA"];
  let startIdx = -1;
  for (const marker of markers) {
    startIdx = html.indexOf(marker);
    if (startIdx >= 0) break;
  }
  if (startIdx < 0) return null;
  const eqIdx = html.indexOf("=", startIdx);
  if (eqIdx < 0) return null;
  const braceStart = html.indexOf("{", eqIdx);
  if (braceStart < 0) return null;
  let depth = 0;
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return html.substring(braceStart, i + 1);
    }
  }
  return null;
}

/**
 * 在已解析的 _ROUTER_DATA JSON 中定位 aweme item。
 * 导航逻辑与 note.ts 主解析器一致（loaderData[pageKey].videoInfoRes.item_list[0]）。
 */
export function findItemInRouterData(rd: string): Record<string, unknown> | null {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(rd);
  } catch {
    return null;
  }
  const loaderData = (json.loaderData ?? {}) as Record<string, unknown>;
  const loaderKeys = Object.keys(loaderData);
  const pageKey =
    loaderKeys.find((k) => k.includes("video_(id)")) ||
    loaderKeys.find((k) => k.includes("note_(id)")) ||
    loaderKeys.find((k) => k.includes("video")) ||
    loaderKeys.find((k) => k.includes("note"));
  const pageData = (pageKey ? loaderData[pageKey] : {}) as Record<string, unknown>;
  const videoInfoRes = (pageData?.videoInfoRes ?? pageData?.videoInfo ?? {}) as Record<
    string,
    unknown
  >;
  const itemList = (videoInfoRes.item_list ?? []) as unknown[];
  if (!Array.isArray(itemList) || itemList.length === 0) return null;
  return itemList[0] as Record<string, unknown>;
}
