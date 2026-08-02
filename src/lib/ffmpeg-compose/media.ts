/**
 * ffmpeg.wasm 图文合成 —— 浏览器端媒体预处理工具
 *
 * 本模块聚合合成流程所需的浏览器侧辅助函数：
 *   - 画布尺寸决策（getCanvasSize）
 *   - 并发控制（withConcurrency）
 *   - 音频 / 视频时长探测（getAudioDuration / getVideoDuration）
 *   - 图片 Canvas 缩放预处理（resizeImageToCanvas）
 *   - concat duration 格式化（fmtDuration）
 *   - 虚拟文件系统安全清理（safeDelete）
 *
 * 这些函数无编排逻辑，可在隔离后独立测试。
 */

import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

/* ------------------------------------------------------------------ */
/* 画布尺寸                                                              */
/* ------------------------------------------------------------------ */

// 抖音标准竖屏分辨率；图片数较多时自动降级，降低编码内存和耗时
// hasLivePhotos: 混合实况模式下实况短片 + 静态帧需要 concat 编码，
//   1080p 在 ffmpeg.wasm 中极慢（WASM x264 仅 5-15fps），故强制降到 540p，
//   清晰度对短视频足够，编码速度较 720p 提升约 2.25 倍（像素量减半）
export function getCanvasSize(
  imageCount: number,
  hasLivePhotos = false
): { width: number; height: number } {
  if (hasLivePhotos) {
    // 混合实况：强制 360p，WASM x264 编码瓶颈 — 像素量仅为 1080p 的 1/9
    // （之前 480p 仍然导致多段视频 concat 重编码时 WASM 超时/内存溢出）
    return { width: 360, height: 640 };
  }
  if (imageCount > 100) return { width: 540, height: 960 };
  if (imageCount > 50) return { width: 720, height: 1280 };
  return { width: 1080, height: 1920 };
}

/* ------------------------------------------------------------------ */
/* 并发控制                                                             */
/* ------------------------------------------------------------------ */

/**
 * 并发控制辅助函数
 */
export async function withConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;

      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
}

/* ------------------------------------------------------------------ */
/* 时长探测                                                             */
/* ------------------------------------------------------------------ */

/**
 * 读取音频时长（秒），用于兜底场景
 */
export async function getAudioDuration(buf: Uint8Array): Promise<number> {
  const blob = new Blob([buf as unknown as BlobPart], { type: "audio/mp4" });
  const url = URL.createObjectURL(blob);
  try {
    const audio = new Audio(url);
    return await new Promise((resolve, reject) => {
      audio.onloadedmetadata = () => resolve(audio.duration);
      audio.onerror = () => reject(new Error("无法读取音频时长"));
      audio.muted = true;
      audio.play().catch(() => {
        // 自动播放失败时仍依赖 onloadedmetadata
      });
      setTimeout(() => {
        if (audio.readyState >= 1 && isFinite(audio.duration)) {
          resolve(audio.duration);
        }
      }, 1000);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 用浏览器 Canvas 将图片统一缩放到目标画布尺寸
 *
 * 优先使用 createImageBitmap（解码效率高），失败则回退到 <img>。
 * 输出固定为 JPEG，确保 concat demuxer 所有输入流参数完全一致。
 */
export async function resizeImageToCanvas(
  imageUrl: string,
  targetW: number,
  targetH: number,
  quality = 0.92
): Promise<Uint8Array> {
  const proxyUrl = `/api/proxy-media?url=${encodeURIComponent(imageUrl)}&filename=img.jpg`;
  const res = await fetch(proxyUrl);
  if (!res.ok) {
    throw new Error(`图片下载失败: ${res.status}`);
  }
  const blob = await res.blob();

  // 解码图片
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    bitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("无法解码图片"));
      };
      img.src = url;
    });
  }

  // 绘制到目标画布（等比缩放 + 黑边填充）
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 canvas 上下文");

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, targetW, targetH);

  const imgW = bitmap.width;
  const imgH = bitmap.height;
  const scale = Math.min(targetW / imgW, targetH / imgH);
  const drawW = Math.round(imgW * scale);
  const drawH = Math.round(imgH * scale);
  const drawX = Math.round((targetW - drawW) / 2);
  const drawY = Math.round((targetH - drawH) / 2);

  ctx.drawImage(bitmap, drawX, drawY, drawW, drawH);

  if (bitmap instanceof ImageBitmap) {
    bitmap.close();
  }

  // 输出 JPEG
  const jpegBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas 导出 JPEG 失败"))),
      "image/jpeg",
      quality
    );
  });

  // 释放 Canvas 显存
  canvas.width = 0;
  canvas.height = 0;

  return new Uint8Array(await jpegBlob.arrayBuffer());
}

/**
 * 将秒数格式化为 3 位小数（concat duration 用）
 */
export function fmtDuration(sec: number): string {
  return Math.max(0.1, sec).toFixed(3);
}

/**
 * 获取视频实际时长（秒）
 *
 * 由于 ffmpeg.wasm 不内置 ffprobe，用 exec 输出到 null 的方式触发 progress 事件，
 * 从中提取最终 time 值作为视频时长。
 */
export async function getVideoDuration(ffmpeg: FFmpegType, filename: string): Promise<number> {
  let resolvedTime = 0;
  const handler = ({ time }: { progress: number; time: number }) => {
    // time 是当前处理到的时间点（秒），最终值即为视频总时长
    if (time > resolvedTime) resolvedTime = time;
  };
  ffmpeg.on("progress", handler);
  try {
    // 输出到 null（/dev/null），仅读取 header 触发 progress 回调
    await ffmpeg.exec(["-i", filename, "-f", "null", "-"]);
  } catch {
    // 某些版本可能报错但已拿到 time 数据，忽略
  } finally {
    ffmpeg.off("progress", handler);
  }
  return Math.max(0.1, resolvedTime); // 最小 0.1s 防止零时长导致 concat 异常
}

/**
 * 清理虚拟文件系统中的文件（忽略错误）
 */
export async function safeDelete(ffmpeg: FFmpegType, name: string): Promise<void> {
  try {
    await ffmpeg.deleteFile(name);
  } catch {
    // ignore
  }
}
