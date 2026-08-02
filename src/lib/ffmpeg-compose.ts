/**
 * ffmpeg.wasm 图文视频合成工具（入口 / 向后兼容层）
 *
 * 原 758 行单文件已按职责拆分为 src/lib/ffmpeg-compose/ 子模块：
 *   - types.ts    共享类型（ComposeStage / ComposeProgress / LivePhotoSegment）
 *   - engine.ts   引擎单例（FFMPEG_BASE + loadScript / loadFFmpeg / unloadFFmpeg）
 *   - media.ts    浏览器媒体预处理工具（getCanvasSize / withConcurrency /
 *                 getAudioDuration / resizeImageToCanvas / fmtDuration /
 *                 getVideoDuration / safeDelete）
 *   - compose.ts  主编排器（composeVideoFromImages）
 *
 * 本文件仅做 re-export，外部调用方（use-compose-video / 各 compose 组件）
 * 无需改动 import 路径。
 */

export type { ComposeStage, ComposeProgress, LivePhotoSegment } from "./ffmpeg-compose/types";
export { loadFFmpeg, unloadFFmpeg } from "./ffmpeg-compose/engine";
export { composeVideoFromImages } from "./ffmpeg-compose/compose";
