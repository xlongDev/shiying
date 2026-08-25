/**
 * ffmpeg 探测与参数构造（可选增强）。
 *
 * 注意：苹果实况照片的打包本身**不需要** ffmpeg（见 jpeg-content-id.ts /
 * mov-content-id.ts）。ffmpeg 仅作为兜底：封面不是 JPEG（例如 WebP）时转码成 JPEG。
 */
import { execFileSync } from "node:child_process";

let ffmpegCache: boolean | null = null;

/**
 * 用 `ffmpeg -version` 探测某路径是否为可用二进制。
 * 用「执行探测」取代 existsSync「读取类」fs，避免被 Next.js NFT 文件追踪误判为「整仓被追踪」。
 */
function isUsableFfmpeg(candidate: string): boolean {
  try {
    execFileSync(candidate, ["-version"], { timeout: 5000, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 解析 ffmpeg 可执行文件路径。
 * 优先级：FFMPEG_PATH 环境变量 > 常见安装位置（执行探测）> "ffmpeg"（交给 PATH）。
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
    if (isUsableFfmpeg(c)) return c;
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

/**
 * 把任意图片（如 WebP）转成 JPEG，**全程内存 I/O，不落临时文件**：
 * 输入从 stdin(pipe:0) 喂入，输出 JPEG 到 stdout(pipe:1) 直接收回 Buffer。
 * 用 execFileSync 取代 writeFileSync + readFileSync，避免触发 NFT 对「读取类」fs 的追踪。
 */
export function transcodeImageToJpeg(input: Buffer): Buffer {
  return execFileSync(
    resolveFfmpegBin(),
    [
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-frames:v",
      "1",
      "-q:v",
      "2",
      "-update",
      "1",
      "-f",
      "mjpeg",
      "pipe:1",
    ],
    { input, maxBuffer: 100 * 1024 * 1024, encoding: "buffer" }
  );
}

/** 运行外部命令（保留给非内存 I/O 的场景）。 */
export function runCommand(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      execFileSync(bin, args, { maxBuffer: 100 * 1024 * 1024, stdio: "ignore" });
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}
