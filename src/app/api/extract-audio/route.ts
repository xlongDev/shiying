import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/rate-limit-guard";
import { spawn } from "child_process";
import path from "path";
import { ffmpegSemaphore } from "@/lib/concurrency";
import { logger } from "@/lib/logger";
import { isAllowedTarget } from "@/lib/ssrf";
import { buildUpstreamHeaders } from "@/lib/cdn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 音频提取代理：从视频中提取音频流 (MP3)
 *
 * 用法：GET /api/extract-audio?url=xxx&filename=xxx
 *
 * 流程：
 *   1. 获取视频流（与 /api/proxy 相同的 header 处理）
 *   2. 视频流读入内存 Buffer
 *   3. 调用 ffmpeg 从 stdin 读取视频、向 stdout 写出 MP3（pipe 模式，不落盘）
 *   4. 返回 MP3 文件给客户端下载
 *
 * 安全加固：
 *   - SSRF：用户传入的 targetUrl 经 isAllowedTarget 校验白名单 + 非内网 IP（含 snssdk 重定向后再校验）。
 *   - ffmpeg 并发受 ffmpegSemaphore 限制（最多 2 个），release 在 finally 中执行。
 *   - getFfmpegPath() 结果在模块作用域缓存，避免每次调用都重新探测。
 *   - 全程内存处理、不写临时文件，规避 Next/Turbopack 构建期 NFT 全目录追踪告警。
 */
// 模块级缓存：ffmpeg 探测结果只计算一次。
let cachedFfmpegPath: string | undefined;

export async function GET(req: NextRequest) {
  const blocked = await guardRateLimit(req, "extract-audio", 10, 60_000);
  if (blocked) return blocked;

  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get("url");
  const filename = searchParams.get("filename") || "audio.mp3";
  const preview = searchParams.get("preview") === "1";

  if (!targetUrl) {
    return NextResponse.json({ ok: false, error: "缺少 url 参数" }, { status: 400 });
  }

  // SSRF：用户传入的 targetUrl 须为白名单内 CDN 主机且解析 IP 非内网。
  if (!(await isAllowedTarget(targetUrl))) {
    return NextResponse.json({ ok: false, error: "禁止访问该地址" }, { status: 403 });
  }

  // 查找 ffmpeg 路径（结果已缓存）
  const ffmpegPath = await getFfmpegPath();
  if (!ffmpegPath) {
    return NextResponse.json(
      { ok: false, error: "服务器未安装 ffmpeg，无法提取音频" },
      { status: 501 }
    );
  }

  try {
    let videoBuffer = await downloadVideo(targetUrl);
    if (!videoBuffer) {
      return NextResponse.json({ ok: false, error: "获取视频流失败" }, { status: 502 });
    }

    // 视频过小则尝试 snssdk play URL 重试
    if (videoBuffer.byteLength < 10240) {
      logger.warn(
        "extract-audio",
        `downloaded video too small (${videoBuffer.byteLength} bytes), trying snssdk retry`
      );
      const videoId = extractVideoId(targetUrl);
      if (videoId) {
        const snssdkUrl = `https://aweme.snssdk.com/aweme/v1/play/?video_id=${videoId}&ratio=720p&line=0`;
        logger.info("extract-audio", `retrying with snssdk: ${snssdkUrl}`);
        const retry = await downloadVideo(snssdkUrl);
        if (retry && retry.byteLength >= 10240) {
          videoBuffer = retry;
        }
      }
    }

    // 最终检查视频大小
    if (videoBuffer.byteLength < 10240) {
      return NextResponse.json(
        { ok: false, error: "下载的视频流为空，无法提取音频" },
        { status: 502 }
      );
    }

    // 调用 ffmpeg 提取音频（并发受信号量限制）
    await ffmpegSemaphore.acquire();
    let audioBuffer: Buffer;
    try {
      audioBuffer = await extractAudioWithFfmpeg(ffmpegPath, videoBuffer);
    } finally {
      ffmpegSemaphore.release();
    }

    // 检查音频大小
    if (audioBuffer.byteLength < 1024) {
      return NextResponse.json(
        { ok: false, error: "提取的音频文件为空，该视频可能没有音轨" },
        { status: 502 }
      );
    }

    const responseHeaders = new Headers({
      "Content-Type": "audio/mpeg",
      "Content-Disposition": preview
        ? "inline"
        : `attachment; filename="${encodeURIComponent(filename)}"`,
      "Content-Length": String(audioBuffer.byteLength),
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });

    return new NextResponse(new Uint8Array(audioBuffer), {
      status: 200,
      headers: responseHeaders,
    });
  } catch (err) {
    logger.error("extract-audio", "error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "音频提取失败" },
      { status: 500 }
    );
  }
}

/* ------------------------------------------------------------------ */
/* 辅助函数                                                            */
/* ------------------------------------------------------------------ */

/**
 * 从视频 URL 中提取 video_id
 * 支持格式:
 *   - aweme.snssdk.com/aweme/v1/play/?video_id=xxx
 *   - aweme.snssdk.com/aweme/v1/playwm/?video_id=xxx
 *   - douyinvod.com/...?video_id=xxx
 */
function extractVideoId(url: string): string | null {
  const match = url.match(/[?&]video_id=([a-z0-9]+)/i);
  return match ? match[1] : null;
}

/**
 * 下载视频流为内存 Buffer（含 SSRF 重定向二次校验 + 非视频内容类型拦截）。
 * 注：iesdouyin iteminfo 签名 API 兜底已废弃（status_code:11110），
 * CDN URL 不含 video_id 时无法自动恢复，交由上层返回 502。
 */
async function downloadVideo(rawUrl: string): Promise<Buffer | null> {
  let finalUrl = rawUrl;
  const isSnssdk = rawUrl.includes("snssdk") && rawUrl.includes("/play");
  if (isSnssdk) {
    try {
      const probe = await fetch(rawUrl, {
        headers: buildUpstreamHeaders(rawUrl),
        redirect: "manual",
      });
      if (probe.status >= 300 && probe.status < 400) {
        const loc = probe.headers.get("location");
        if (loc) {
          finalUrl = new URL(loc, rawUrl).toString();
          // 重定向后的地址可能来自不同主机，需再次做 SSRF 校验。
          if (!(await isAllowedTarget(finalUrl))) return null;
        }
      }
    } catch {
      /* 使用原始 URL */
    }
  }

  const videoRes = await fetch(finalUrl, {
    headers: buildUpstreamHeaders(finalUrl),
    redirect: "follow",
  });

  if (!videoRes.ok || !videoRes.body) return null;

  const contentType = videoRes.headers.get("content-type") || "";
  // 简单校验：返回的是 JSON 或 HTML 错误页（不是视频流）
  if (contentType.includes("json") || contentType.includes("html")) {
    logger.error("extract-audio", `upstream returned non-video content-type: ${contentType}`);
    return null;
  }

  return Buffer.from(await videoRes.arrayBuffer());
}

/**
 * 查找可用的 ffmpeg 可执行文件路径（结果在模块作用域缓存）
 * 1. 项目 bin 目录 (./bin/ffmpeg)
 * 2. 系统 PATH (ffmpeg)
 * 3. serverless 回退：ffmpeg-static（部署到无系统 ffmpeg 的环境时安装该可选依赖）
 */
async function getFfmpegPath(): Promise<string | null> {
  if (cachedFfmpegPath) return cachedFfmpegPath;

  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), "bin", "ffmpeg"),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "bin", "ffmpeg.exe"),
    "ffmpeg",
  ];

  // serverless 回退：ffmpeg-static（仅在部署时安装该可选依赖后生效）。
  // webpackIgnore: 交由运行时原生 import，构建期不静态解析、不进入 NFT 追踪。
  try {
    const spec: string = "ffmpeg-static";
    const staticMod = (await import(/* webpackIgnore: true */ spec).catch(() => null)) as {
      default?: string;
      path?: string;
    } | null;
    const staticPath = staticMod?.default ?? staticMod?.path;
    if (staticPath) candidates.unshift(staticPath);
  } catch {
    /* 未安装 ffmpeg-static，忽略 */
  }

  for (const candidate of candidates) {
    if (await checkFfmpeg(candidate)) {
      cachedFfmpegPath = candidate;
      return candidate;
    }
  }
  return null;
}

function checkFfmpeg(ffmpegPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(ffmpegPath, ["-version"], { stdio: "ignore" });
      proc.on("error", () => resolve(false));
      proc.on("exit", (code) => resolve(code === 0));
      setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
        resolve(false);
      }, 3000);
    } catch {
      resolve(false);
    }
  });
}

function extractAudioWithFfmpeg(ffmpegPath: string, videoBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // 视频从 stdin (pipe:0) 读入；音频 MP3 直接写 stdout (pipe:1)，全程不落盘。
    const args = [
      "-i",
      "pipe:0",
      "-vn",
      "-acodec",
      "libmp3lame",
      "-ab",
      "192k",
      "-ar",
      "44100",
      "-f",
      "mp3",
      "-y",
      "pipe:1",
    ];

    const ffmpeg = spawn(ffmpegPath, args);
    const errorChunks: string[] = [];
    const chunks: Buffer[] = [];

    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      errorChunks.push(chunk.toString());
      if (errorChunks.join("").length > 50000) {
        errorChunks.shift();
      }
    });

    ffmpeg.on("error", (err) => reject(err));

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        const stderr = errorChunks.join("").slice(-1000);
        logger.error("extract-audio", `ffmpeg exited with code ${code}: ${stderr}`);
        reject(new Error(`ffmpeg 处理失败 (code ${code})`));
      }
    });

    // 将视频 Buffer 写入 stdin（处理背压后关闭），ffmpeg 从 stdout 产出 MP3。
    const finishStdin = (): void => {
      try {
        ffmpeg.stdin.end();
      } catch {
        /* ignore */
      }
    };
    ffmpeg.stdin.on("error", (err) => reject(err));
    if (ffmpeg.stdin.write(videoBuffer)) {
      finishStdin();
    } else {
      ffmpeg.stdin.once("drain", finishStdin);
    }

    setTimeout(() => {
      try {
        ffmpeg.kill();
      } catch {
        /* ignore */
      }
      reject(new Error("ffmpeg 处理超时"));
    }, 240000);
  });
}
