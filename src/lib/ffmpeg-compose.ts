/**
 * ffmpeg.wasm 图文视频合成工具
 *
 * 为了解决大数量图片（如 100 张）合成时黑屏、内存爆炸的问题，
 * 本实现采用“浏览器 Canvas 预统一尺寸 + concat demuxer”的两阶段方案：
 *
 * 阶段 1：下载并预处理每张图片
 *   - 限制并发下载（默认 5）
 *   - 用浏览器 Canvas 将图片等比缩放并黑边填充到固定画布尺寸
 *   - 输出为统一格式的 JPEG，写入 ffmpeg 虚拟文件系统
 *   - 不保留原始 buffer，处理完即释放
 *
 * 阶段 2：concat demuxer 合成最终视频
 *   - 生成 concat.txt，按计算好的单图时长拼接
 *   - 只有 1 路视频输入（+ 可选 1 路音频），filter 图非常简单
 *   - 避免 100 路 filter_complex 输入导致 wasm 内存/命令溢出
 *
 * 文件从本地 public/ffmpeg/ 加载（同源），避免 Worker 跨域错误
 * - /ffmpeg/ffmpeg.js         — @ffmpeg/ffmpeg UMD 主脚本
 * - /ffmpeg/814.ffmpeg.js     — Worker chunk
 * - /ffmpeg/ffmpeg-core.js    — @ffmpeg/core 引擎
 * - /ffmpeg/ffmpeg-core.wasm  — WASM 二进制（约 30MB）
 */

import { toBlobURL, fetchFile } from "@ffmpeg/util";
import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";
import { logger } from "./logger";

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

/* ------------------------------------------------------------------ */
/* 本地静态文件路径（同源，避免 Worker 跨域）                            */
/* ------------------------------------------------------------------ */

const FFMPEG_BASE = "/ffmpeg"; // public/ffmpeg/ 目录

/* ------------------------------------------------------------------ */
/* 画布尺寸                                                              */
/* ------------------------------------------------------------------ */

// 抖音标准竖屏分辨率；图片数较多时自动降级，降低编码内存和耗时
// hasLivePhotos: 混合实况模式下实况短片 + 静态帧需要 concat 编码，
//   1080p 在 ffmpeg.wasm 中极慢（WASM x264 仅 5-15fps），故强制降到 540p，
//   清晰度对短视频足够，编码速度较 720p 提升约 2.25 倍（像素量减半）
function getCanvasSize(
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
/* 单例管理                                                             */
/* ------------------------------------------------------------------ */

let ffmpegInstance: FFmpegType | null = null;
let loadingPromise: Promise<FFmpegType> | null = null;

/**
 * 动态加载 UMD 脚本（从本地 public 目录）
 */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.dataset.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`脚本加载失败: ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * 加载 ffmpeg.wasm 引擎（单例缓存）
 */
export async function loadFFmpeg(onLog?: (msg: string) => void): Promise<FFmpegType> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    onLog?.("正在加载 ffmpeg 库...");

    await loadScript(`${FFMPEG_BASE}/ffmpeg.js`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const FFmpeg = w.FFmpegWASM?.FFmpeg;
    if (!FFmpeg) throw new Error("FFmpegWASM.FFmpeg 未找到，脚本加载可能失败");

    const ffmpeg: FFmpegType = new FFmpeg();

    onLog?.("正在加载 ffmpeg 核心引擎（约 30MB）...");
    const coreURL = await toBlobURL(`${FFMPEG_BASE}/ffmpeg-core.js`, "text/javascript");
    const wasmURL = await toBlobURL(`${FFMPEG_BASE}/ffmpeg-core.wasm`, "application/wasm");

    await ffmpeg.load({ coreURL, wasmURL });

    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  return loadingPromise;
}

/**
 * 卸载 ffmpeg.wasm 引擎，释放 Worker / WASM 内存
 *
 * 合成并下载完成后调用，避免 ffmpeg 引擎常驻占用约 30MB+ 内存。
 * 下次合成时会自动重新加载。
 */
export function unloadFFmpeg(): void {
  if (ffmpegInstance) {
    try {
      // terminate 会终止底层 Worker
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ffmpegInstance as any).terminate?.();
    } catch {
      // ignore
    }
    ffmpegInstance = null;
    loadingPromise = null;
  }
}

/**
 * 并发控制辅助函数
 */
async function withConcurrency<T>(
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

/**
 * 读取音频时长（秒），用于兜底场景
 */
async function getAudioDuration(buf: Uint8Array): Promise<number> {
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
async function resizeImageToCanvas(
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
function fmtDuration(sec: number): string {
  return Math.max(0.1, sec).toFixed(3);
}

/**
 * 获取视频实际时长（秒）
 *
 * 由于 ffmpeg.wasm 不内置 ffprobe，用 exec 输出到 null 的方式触发 progress 事件，
 * 从中提取最终 time 值作为视频时长。
 */
async function getVideoDuration(ffmpeg: FFmpegType, filename: string): Promise<number> {
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
async function safeDelete(ffmpeg: FFmpegType, name: string): Promise<void> {
  try {
    await ffmpeg.deleteFile(name);
  } catch {
    // ignore
  }
}

/**
 * 合成图文视频（支持混合实况模式）
 *
 * @param imageUrls  图片 URL 列表（原始抖音 URL）
 * @param musicUrl   音乐 URL（可选，null 表示无音乐）
 * @param duration   目标时长（秒），0 则自动计算
 * @param onProgress 进度回调
 * @param options    可选参数：
 *   - perImage: 每张图片显示秒数（0/undefined 表示自动）
 *   - livePhotos: 混合实况片段数组，指定哪些索引用动态短片替代静态图
 *   - awemeId: 可选，当 musicUrl 为空时用于动态获取 BGM
 * @returns 合成的 MP4 Blob
 */
export async function composeVideoFromImages(
  imageUrls: string[],
  musicUrl: string | null,
  duration: number,
  onProgress: (p: ComposeProgress) => void,
  options?: { perImage?: number; livePhotos?: LivePhotoSegment[]; awemeId?: string }
): Promise<Blob> {
  const totalImages = imageUrls.length;
  if (totalImages === 0) {
    throw new Error("至少需要 1 张图片");
  }

  // 构建实况照片索引查找表（O(1) 查找）
  const livePhotoMap = new Map<number, LivePhotoSegment>();
  if (options?.livePhotos) {
    for (const lp of options.livePhotos) {
      livePhotoMap.set(lp.index, lp);
    }
  }
  const hasLivePhotos = livePhotoMap.size > 0;

  const ffmpeg = await loadFFmpeg((msg) => {
    onProgress({
      stage: "loading-ffmpeg",
      progress: 50,
      message: msg,
    });
  });

  onProgress({
    stage: "loading-ffmpeg",
    progress: 100,
    message: "ffmpeg 引擎就绪",
  });
  const { width: targetW, height: targetH } = getCanvasSize(totalImages, hasLivePhotos);

  // 统一输出为偶数分辨率（x264 要求）
  const canvasW = Math.floor(targetW / 2) * 2;
  const canvasH = Math.floor(targetH / 2) * 2;

  // 图片数量多时降低 JPEG 质量，减少内存占用
  const jpegQuality = totalImages > 100 ? 0.75 : totalImages > 50 ? 0.85 : 0.92;

  // ---- Step 1: 下载并预处理图片（含实况短片） ----
  onProgress({
    stage: "downloading-images",
    progress: 0,
    message: hasLivePhotos ? "正在下载并处理图片与实况短片..." : "正在下载并处理图片...",
  });

  // 每个输出片段的信息（可能是 JPEG 帧或 MP4 视频）
  interface SegmentInfo {
    file: string; // ffmpeg 虚拟文件系统中的文件名
    duration: number; // 该片段时长（秒），0 表示使用默认 perImage
    isVideo: boolean; // true=实况视频段, false=静态图帧
  }

  const segments: SegmentInfo[] = new Array(totalImages);
  let liveVideoCount = 0;

  await withConcurrency(imageUrls, 3, async (url, i) => {
    const lp = livePhotoMap.get(i);

    if (lp && lp.videoUrl) {
      // ---- 实况照片：下载动态视频并转码到目标分辨率 ----
      liveVideoCount++;
      const segName = `live_${String(i).padStart(3, "0")}.mp4`;

      // 通过代理下载实况视频
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(lp.videoUrl)}&filename=live_${i}.mp4`;
      const vidBuf = await fetchFile(proxyUrl);
      await ffmpeg.writeFile(`live_src_${i}.mp4`, vidBuf);

      // 转码到目标分辨率和帧率，确保所有片段参数一致
      await ffmpeg.exec([
        "-y",
        "-i",
        `live_src_${i}.mp4`,
        "-vf",
        `scale=${canvasW}:${canvasH}:force_original_aspect_ratio=decrease,pad=${canvasW}:${canvasH}:(ow-iw)/2:(oh-ih)/2`,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-g",
        "30",
        "-r",
        "25",
        "-an",
        segName,
      ]);

      // 清理源文件释放内存
      try {
        await ffmpeg.deleteFile(`live_src_${i}.mp4`);
      } catch {
        /* ignore */
      }

      // 探测转码后视频的实际时长（避免 concat 时因时长不匹配导致卡帧）
      const actualDuration = await getVideoDuration(ffmpeg, segName);

      segments[i] = { file: segName, duration: actualDuration, isVideo: true };

      onProgress({
        stage: hasLivePhotos ? "downloading-live-videos" : "downloading-images",
        progress: Math.round(((i + 1) / totalImages) * 100),
        message: `正在处理实况短片 ${liveVideoCount}/${livePhotoMap.size} (${i + 1}/${totalImages})`,
      });
    } else {
      // ---- 普通图片：Canvas 缩放为 JPEG 帧 ----
      const frameName = `frame_${String(i).padStart(3, "0")}.jpg`;
      const buf = await resizeImageToCanvas(url, canvasW, canvasH, jpegQuality);
      await ffmpeg.writeFile(frameName, buf);

      segments[i] = { file: frameName, duration: 0, isVideo: false };

      onProgress({
        stage: "downloading-images",
        progress: Math.round(((i + 1) / totalImages) * 100),
        message: `正在处理图片 ${i + 1}/${totalImages}`,
      });
    }
  });

  // ---- Step 1.5: 汇总实况视频实际时长 ----
  if (hasLivePhotos && liveVideoCount > 0) {
    const liveDurations = segments
      .filter((s) => s.isVideo)
      .map((s) => `${s.file}=${s.duration.toFixed(1)}s`);
    onProgress({
      stage: "downloading-live-videos",
      progress: 100,
      message: `实况短片就绪 (${liveVideoCount}个, ${liveDurations.join(", ")})`,
    });
  }

  // ---- Step 2: 下载音乐（支持降级：musicUrl 为空时通过 awemeId 动态获取）----
  let musicBuffer: Uint8Array | null = null;
  let musicDuration = duration > 0 ? duration : 0;
  let effectiveMusicUrl = musicUrl;

  // 降级：如果未提供 musicUrl 但有 awemeId，尝试动态获取
  if (!effectiveMusicUrl && options?.awemeId) {
    onProgress({
      stage: "downloading-music",
      progress: 0,
      message: "正在获取背景音乐信息...",
    });
    try {
      // 调用 download-music API 端点获取音乐（仅取 URL）
      const musicInfoRes = await fetch(
        `/api/download-music?awemeId=${encodeURIComponent(options.awemeId)}&filename=music.m4a`
      );
      if (musicInfoRes.ok) {
        const blob = await musicInfoRes.blob();
        if (blob.size > 1000) {
          // API 直接返回了音频文件内容
          musicBuffer = new Uint8Array(await blob.arrayBuffer());
          await ffmpeg.writeFile("music.bin", musicBuffer);
          effectiveMusicUrl = "_internal_fallback_"; // 标记为已写入
          onProgress({
            stage: "downloading-music",
            progress: 100,
            message: "背景音乐获取完成",
          });
        }
      }
    } catch (err) {
      logger.warn("compose", "音乐降级获取失败，将合成无音乐版本:", err);
    }
  }

  if (effectiveMusicUrl && effectiveMusicUrl !== "_internal_fallback_") {
    onProgress({
      stage: "downloading-music",
      progress: 0,
      message: "正在下载音乐...",
    });

    const proxyUrl = `/api/proxy-media?url=${encodeURIComponent(effectiveMusicUrl)}&filename=music.m4a`;
    musicBuffer = await fetchFile(proxyUrl);
    await ffmpeg.writeFile("music.bin", musicBuffer);

    onProgress({
      stage: "downloading-music",
      progress: 100,
      message: "音乐下载完成",
    });

    // 优先用解析时已获取的时长；兜底用 Audio 元素读取
    if (musicDuration <= 0 && musicBuffer) {
      try {
        musicDuration = await getAudioDuration(musicBuffer);
      } catch {
        musicDuration = 0;
      }
    }

    // 释放 JS 侧的音频 buffer，数据已在 ffmpeg 虚拟文件系统中
    musicBuffer = null;
  } else if (effectiveMusicUrl === "_internal_fallback_") {
    // 降级获取已写入 music.bin，读取时长
    try {
      const buf = (await ffmpeg.readFile("music.bin")) as Uint8Array;
      if (musicDuration <= 0 && buf) {
        musicDuration = await getAudioDuration(buf);
      }
    } catch {
      musicDuration = 0;
    }
  }

  // ---- Step 3: 计算时长并生成统一格式的视频片段 ----
  onProgress({
    stage: "synthesizing",
    progress: 0,
    message: hasLivePhotos ? "正在准备混合合成（静态图+实况短片）..." : "正在准备合成...",
  });

  // 每张静态图片显示时长：用户自定义 > 音乐时长均分 > 抖音默认 3 秒
  let perImage: number;
  if (options?.perImage && options.perImage > 0) {
    perImage = options.perImage;
  } else if (musicUrl && musicDuration > 0) {
    perImage = musicDuration / totalImages;
  } else if (duration > 0) {
    perImage = duration / totalImages;
  } else {
    perImage = 3; // 抖音官方默认 3 秒切换一张图
  }

  const effectivePerImage = Math.max(perImage, 0.2);

  // 混合模式：需要将静态图片帧转为短视频片段，以便与实况视频 concat
  if (hasLivePhotos) {
    // 统计需要转换的静态图片数量
    const staticSegs = segments.filter((s) => !s.isVideo);
    const totalStatic = staticSegs.length;
    let converted = 0;

    onProgress({
      stage: "synthesizing",
      progress: 0,
      message: `正在转换静态图片为视频片段 (0/${totalStatic})...`,
    });

    // 将每个静态 JPEG 帧循环播放为 short video clip
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!seg.isVideo) {
        // 静态图片：loop 单帧为 perImage 时长的视频
        const clipName = `clip_${String(i).padStart(3, "0")}.mp4`;
        await ffmpeg.exec([
          "-y",
          "-loop",
          "1",
          "-i",
          seg.file,
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-pix_fmt",
          "yuv420p",
          "-g",
          "30",
          "-r",
          "25",
          "-t",
          fmtDuration(effectivePerImage),
          "-an",
          clipName,
        ]);
        segments[i] = { file: clipName, duration: effectivePerImage, isVideo: false };
        // 清理原始 JPEG 文件
        try {
          await ffmpeg.deleteFile(seg.file);
        } catch {
          /* ignore */
        }

        converted++;
        // 转换阶段映射：0% → 30%（为最终编码预留 30→100 的进度空间）
        onProgress({
          stage: "synthesizing",
          progress: Math.round((converted / Math.max(1, totalStatic)) * 30),
          message: `正在转换静态图片为视频片段 (${converted}/${totalStatic})...`,
        });
      }
      // 实况视频段保持不变（已经是目标规格的 MP4）
    }

    onProgress({
      stage: "synthesizing",
      progress: 32,
      message: "所有片段已就绪，开始拼接编码...",
    });
  }

  // 生成 concat.txt
  const concatLines: string[] = ["ffconcat version 1.0"];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    concatLines.push(`file '${seg.file}'`);

    // 使用该片段的实际时长（实况视频为探测到的真实时长，静态图为 effectivePerImage）
    const segDuration = seg.duration > 0 ? seg.duration : effectivePerImage;
    concatLines.push(`duration ${fmtDuration(segDuration)}`);
  }
  // concat demuxer 需要在最后再次声明最后一帧，以正确结束最后一段
  concatLines.push(`file '${segments[segments.length - 1].file}'`);

  const concatContent = concatLines.join("\n");
  await ffmpeg.writeFile("concat.txt", new TextEncoder().encode(concatContent));

  // ---- Step 4: 执行最终合成 ----
  const hasMusic = !!effectiveMusicUrl;

  // 统一使用 ultrafast 编码（不使用 -c:v copy）：
  // ffmpeg.wasm 的 concat demuxer + stream copy 存在兼容性问题：
  //   1. +genpts 在 WASM 中可能触发无限 PTS 重计算导致死锁
  //   2. WASM 环境下 muxer 行为与原生 ffmpeg 不一致
  //   3. copy 模式无逐帧进度事件，UI 卡在固定百分比（如 79%）
  //
  // 关键修复（解决卡 99% 超时失败的根因）：
  //   - 移除 -t 标志：concat.txt 已含每段 duration，双重时长指定导致 WASM muxer 异常
  //   - 用 -shortest 替代：视频以最短输入（音频）为准自动截断
  //   - 加 -movflags +faststart：确保 moov atom 前置，避免 WASM 中写入挂起
  //   - 加 -max_muxing_queue_size 128：防止多段 concat 时 muxer 队列溢出
  const encodeCommand = ["-y", "-f", "concat", "-safe", "0", "-i", "concat.txt"];
  if (hasMusic) {
    encodeCommand.push("-stream_loop", "-1", "-i", "music.bin");
  }
  encodeCommand.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-r", "25");
  if (hasMusic) {
    // -shortest：当音频短于视频时，以音频长度截断视频（替代有问题的 -t）
    encodeCommand.push("-c:a", "aac", "-b:a", "128k", "-shortest");
  } else {
    encodeCommand.push("-an");
  }
  encodeCommand.push("-movflags", "+faststart", "-max_muxing_queue_size", "128", "output.mp4");

  const runCommand = encodeCommand;

  // 进入合成阶段：接续静态图转换（0→30），编码从 32→100 平滑过渡
  onProgress({
    stage: "synthesizing",
    progress: 32,
    message: "所有片段已就绪，开始拼接编码...",
  });

  let lastProgressTime = Date.now();
  let stalled = false;

  const progressHandler = ({ progress: rawProgress }: { progress: number }) => {
    lastProgressTime = Date.now();
    const raw = Math.min(1, Math.max(0, rawProgress));
    // 分段曲线：前段用 √ 压缩避免初期冲高；末段线性收尾快速到达 100
    let curved: number;
    if (raw <= 0.85) {
      curved = Math.sqrt(raw) * 0.92;
    } else {
      const t = (raw - 0.85) / 0.15;
      curved = 0.92 + t * 0.08;
    }
    const subP = Math.min(100, Math.round(32 + curved * 68));
    onProgress({
      stage: "synthesizing",
      progress: subP,
      message: rawProgress > 0.98 ? "正在完成最后写入..." : "正在编码合成视频...",
    });
  };

  ffmpeg.on("progress", progressHandler);

  // 超时监控：如果 120 秒内没有任何 progress 事件，认为 ffmpeg 已死锁
  const stallMonitor = setInterval(() => {
    if (Date.now() - lastProgressTime > 120000 && !stalled) {
      stalled = true;
      logger.warn("compose", "ffmpeg 进度停滞超过 120s，可能已死锁");
    }
  }, 10000);

  try {
    await ffmpeg.exec(runCommand);
  } finally {
    clearInterval(stallMonitor);
    ffmpeg.off("progress", progressHandler);
  }

  if (stalled) {
    throw new Error(
      "视频编码超时：ffmpeg 进程无响应超过 2 分钟。可能是视频片段过多或分辨率过高导致 WASM 内存不足。"
    );
  }

  // ---- Step 5: 清理所有临时文件，再读取结果 ----
  // 所有片段文件在合成后不再需要，清理后释放 ffmpeg 虚拟文件系统内存
  for (const seg of segments) {
    await safeDelete(ffmpeg, seg.file);
  }
  await safeDelete(ffmpeg, "concat.txt");
  if (hasMusic) {
    await safeDelete(ffmpeg, "music.bin");
  }

  const data = await ffmpeg.readFile("output.mp4");
  await safeDelete(ffmpeg, "output.mp4");

  onProgress({
    stage: "done",
    progress: 100,
    message: "合成完成",
  });

  return new Blob([data as unknown as BlobPart], { type: "video/mp4" });
}
