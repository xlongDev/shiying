/**
 * 抖音解析器统一入口（barrel）。
 *
 * 历史：`parser.ts` 曾是一个 776 行的「上帝模块」。现按职责拆分为：
 *   - types.ts    领域模型（LivePhotoInfo / ParsedVideo / ParseError）
 *   - extract.ts  纯工具函数（URL 提取 / 归一化 / 音乐提取等）
 *   - note.ts     普通视频 / 图文帖解析（原 parseDouyin）
 *   - slides.ts   混合图文解析（原 parseSlides）
 *
 * 本文件保持 `@/lib/parser` 出口不变，所有原有导出继续可用，业务层无需改动导入路径。
 */

export * from "./types";
export * from "./extract";
export * from "./note";
export * from "./slides";

import { parseDouyin } from "./note";
import { extractUrl } from "./extract";
import { ParseError } from "./types";
import type { ParsedVideo } from "./types";
import { getCachedParse, setCachedParse } from "./cache";

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

  // 短 TTL 缓存：命中则直接返回深拷贝，避免重复打上游 / 重启 Chrome（高成本）。
  const cacheKey = `v1:${url}::${options?.skipLivePhoto ? "1" : "0"}`;
  const cached = getCachedParse(cacheKey);
  if (cached) return cached;

  const result = await parseDouyin(rawUrl, options);
  // 存入原始结果（不被调用方修改），返回深拷贝（调用方会就地改 livePhotoPending 等字段）。
  setCachedParse(cacheKey, result);
  return structuredClone(result);
}
