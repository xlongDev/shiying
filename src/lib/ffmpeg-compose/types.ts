/**
 * ffmpeg.wasm 图文视频合成 —— 共享类型定义
 *
 * 实际合成逻辑见 ./compose.ts（编排器）、./engine.ts（引擎单例）、
 * ./media.ts（浏览器媒体预处理工具）。本文件仅承载跨模块复用的类型。
 */

export type ComposeStage =
  | "loading-ffmpeg"
  | "downloading-images"
  | "downloading-music"
  | "downloading-live-videos"
  | "synthesizing"
  | "done"
  | "error";

export interface ComposeProgress {
  stage: ComposeStage;
  progress: number; // 0-100
  message: string;
}

/**
 * 混合实况照片片段：用于在图文合成时将指定索引的图片替换为实况动态短片
 */
export interface LivePhotoSegment {
  /** 图片在 imageUrls 数组中的索引 */
  index: number;
  /** 实况动态短片的完整 URL */
  videoUrl: string;
}
