/**
 * 图文视频合成 —— 纯函数辅助（无 ffmpeg / 无副作用，可单测）
 *
 * 从 compose.ts 的 composeVideoFromImages 中抽取出与浏览器媒体预处理、
 * 引擎实例无关的三段纯逻辑：concat 清单生成、最终编码命令构建、进度曲线映射。
 * 便于独立单元测试，也降低主编排器的单文件体积。
 */
import { fmtDuration } from "./media";

/** 单个合成片段（静态 JPEG 帧或实况 MP4 短片）的描述 */
export interface SegmentInfo {
  /** ffmpeg 虚拟文件系统中的文件名 */
  file: string;
  /** 该片段时长（秒），0 表示使用默认 perImage */
  duration: number;
  /** true=实况视频段, false=静态图帧 */
  isVideo: boolean;
}

/**
 * 生成 ffmpeg concat demuxer 清单文本。
 * 每段声明 `file` + `duration`；末尾重复声明最后一帧以正确结束最后一段。
 */
export function buildConcatList(segments: SegmentInfo[], effectivePerImage: number): string {
  const lines = ["ffconcat version 1.0"];
  for (const seg of segments) {
    lines.push(`file '${seg.file}'`);
    // 实况视频用探测到的真实时长，静态图用 effectivePerImage
    const segDuration = seg.duration > 0 ? seg.duration : effectivePerImage;
    lines.push(`duration ${fmtDuration(segDuration)}`);
  }
  // concat demuxer 需要在最后再次声明最后一帧，以正确结束最后一段
  lines.push(`file '${segments[segments.length - 1].file}'`);
  return lines.join("\n");
}

/**
 * 构建最终合成命令（concat demuxer + 可选音频循环）。
 * 统一 ultrafast 编码 + faststart，避免 WASM muxer 死锁。
 */
export function buildEncodeCommand(withMusic: boolean): string[] {
  const cmd = ["-y", "-f", "concat", "-safe", "0", "-i", "concat.txt"];
  if (withMusic) {
    // 音频短于视频时以音频长度截断（-shortest），替代有问题的 -t
    cmd.push("-stream_loop", "-1", "-i", "music.bin");
  }
  cmd.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-r", "25");
  if (withMusic) {
    cmd.push("-c:a", "aac", "-b:a", "128k", "-shortest");
  } else {
    cmd.push("-an");
  }
  cmd.push("-movflags", "+faststart", "-max_muxing_queue_size", "128", "output.mp4");
  return cmd;
}

/**
 * 将 ffmpeg 原始进度 [0,1] 映射为合成 UI 进度曲线：
 * 前段用 √ 压缩避免初期冲高；末段线性收尾快速到达 100。
 * 返回值落在 [0,1]，调用方再映射到 32→100 的 UI 区间。
 */
export function curveProgress(rawProgress: number): number {
  const raw = Math.min(1, Math.max(0, rawProgress));
  if (raw <= 0.85) {
    return Math.sqrt(raw) * 0.92;
  }
  const t = (raw - 0.85) / 0.15;
  return 0.92 + t * 0.08;
}
