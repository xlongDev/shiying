/**
 * 实况照片（LivePhoto）解析 —— 共享类型定义。
 *
 * 抖音实况照片 = 一张静态原图 + 一段 douyinvod 动态短片。解析结果统一用
 * ResolvedLivePhoto {index, imageUrl, videoUrl} 表示，index 对应原帖图片序号。
 */
export interface ResolvedLivePhoto {
  index: number;
  imageUrl: string;
  videoUrl: string;
}

/**
 * 轻量预检状态：
 * - live：明确检测到实况照片（附资源）
 * - uncertain：SSR/API 未给出明确标记（单图实况常无标记）→ 交由浏览器兜底
 */
export type LivePhotoPresence =
  { status: "live"; lives: ResolvedLivePhoto[] } | { status: "uncertain"; reason: string };

/** 浏览器 fiber 遍历统计（用于「真静态帖」短路，避免无效重试） */
export type PagePhotoStats = {
  hasImageArray: boolean;
  maxImageArrayLength: number;
  liveCountInMaxArray: number;
};

export type PageExtractResult = {
  lives: ResolvedLivePhoto[];
  stats: PagePhotoStats;
};

export type RouterDataExtractResult = {
  lives: ResolvedLivePhoto[];
  item?: Record<string, unknown>;
  hasData: boolean;
};
