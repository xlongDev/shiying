/**
 * ffmpeg.wasm 引擎管理 —— 单例加载 / 卸载
 *
 * 加载 ffmpeg.wasm 引擎（约 30MB WASM + UMD 脚本），以模块级单例缓存，
 * 避免重复加载开销；合成完成后可 unload 释放 Worker / WASM 内存。
 */

import { toBlobURL } from "@ffmpeg/util";
import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

/* ------------------------------------------------------------------ */
/* 本地静态文件路径（同源，避免 Worker 跨域）                            */
/* ------------------------------------------------------------------ */

const FFMPEG_BASE = "/ffmpeg"; // public/ffmpeg/ 目录

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

    // eslint-disable-next-line typescript/no-explicit-any
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
      // eslint-disable-next-line typescript/no-explicit-any
      (ffmpegInstance as any).terminate?.();
    } catch {
      // ignore
    }
    ffmpegInstance = null;
    loadingPromise = null;
  }
}
