/**
 * ffmpeg 探测与参数构造（可选增强）。
 *
 * 注意：苹果实况照片的打包本身**不需要** ffmpeg（见 jpeg-content-id.ts /
 * mov-content-id.ts）。ffmpeg 仅作为兜底：封面不是 JPEG（例如 WebP）时转码成 JPEG。
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

let ffmpegCache: boolean | null = null;

/**
 * 解析 ffmpeg 可执行文件路径。
 * 优先级：FFMPEG_PATH 环境变量 > 常见安装位置 > "ffmpeg"（交给 PATH）。
 * 探测绝对路径是因为 dev server 常常不继承登录 shell 的 PATH。
 */
export function resolveFfmpegBin(): string {
  if (process.env.FFMPEG_PATH) {
    return process.env.FFMPEG_PATH;
  }
  const candidates = [
    "/opt/homebrew/bin/ffmpeg", // Apple Silicon Homebrew
    "/usr/local/bin/ffmpeg", // Intel Homebrew / 手动安装
    "/usr/bin/ffmpeg", // 部分发行版 / Docker
    "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "ffmpeg";
}

/** 系统是否可用 ffmpeg（结果缓存）。 */
export function hasFfmpeg(): boolean {
  if (ffmpegCache !== null) return ffmpegCache;
  try {
    execFileSync(resolveFfmpegBin(), ["-version"], { timeout: 5000, stdio: "ignore" });
    ffmpegCache = true;
  } catch {
    ffmpegCache = false;
  }
  return ffmpegCache;
}

/** 仅供测试：重置探测缓存。 */
export function resetFfmpegCache(): void {
  ffmpegCache = null;
}

/** 构造把任意图片转成 JPEG 的 ffmpeg 参数（封面不是 JPEG 时兜底）。 */
export function buildImageToJpegArgs(opts: { input: string; out: string }): string[] {
  return ["-y", "-i", opts.input, "-frames:v", "1", "-q:v", "2", "-update", "1", opts.out];
}

/** 运行外部命令。 */
export function runCommand(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 100 * 1024 * 1024 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
