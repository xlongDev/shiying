import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/rate-limit-guard";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
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
 *   2. 将视频流写入临时文件
 *   3. 调用 ffmpeg 从临时文件提取音频并转码为 MP3
 *   4. 返回 MP3 文件给客户端下载
 *   5. 清理临时文件
 *
 * 安全加固：
 *   - SSRF：用户传入的 targetUrl 经 isAllowedTarget 校验白名单 + 非内网 IP（含 snssdk 重定向后再校验）。
 *   - ffmpeg 并发受 ffmpegSemaphore 限制（最多 2 个），release 在 finally 中执行。
 *   - getFfmpegPath() 结果在模块作用域缓存，避免每次调用都重新探测。
 *   - 临时文件在所有返回 / 异常路径均由外层 finally 统一清理。
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
  let videoTempPath = "";
  let audioTempPath = "";

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
    // 获取真实视频 URL（处理 snssdk 重定向）
    let finalUrl = targetUrl;
    const isSnssdk = targetUrl.includes("snssdk") && targetUrl.includes("/play");
    if (isSnssdk) {
      try {
        const probe = await fetch(targetUrl, {
          headers: buildUpstreamHeaders(targetUrl),
          redirect: "manual",
        });
        if (probe.status >= 300 && probe.status < 400) {
          const loc = probe.headers.get("location");
          if (loc) {
            finalUrl = new URL(loc, targetUrl).toString();
            // 重定向后的地址可能来自不同主机，需再次做 SSRF 校验。
            if (!(await isAllowedTarget(finalUrl))) {
              return NextResponse.json({ ok: false, error: "禁止访问该地址" }, { status: 403 });
            }
          }
        }
      } catch {
        // 使用原始 URL
      }
    }

    // 下载视频流到临时文件
    const videoRes = await fetch(finalUrl, {
      headers: buildUpstreamHeaders(finalUrl),
      redirect: "follow",
    });

    if (!videoRes.ok || !videoRes.body) {
      logger.error(
        "extract-audio",
        `upstream failed: ${videoRes.status} for ${finalUrl.substring(0, 120)}`
      );
      return NextResponse.json(
        { ok: false, error: `获取视频流失败：HTTP ${videoRes.status}` },
        { status: 502 }
      );
    }

    const contentType = videoRes.headers.get("content-type") || "";

    // 简单校验：返回的是 JSON 或 HTML 错误页（不是视频流）
    if (contentType.includes("json") || contentType.includes("html")) {
      logger.error("extract-audio", `upstream returned non-video content-type: ${contentType}`);
      return NextResponse.json(
        { ok: false, error: "上游返回的不是视频流，无法提取音频" },
        { status: 502 }
      );
    }

    // 写入临时视频文件
    videoTempPath = path.join(os.tmpdir(), `extract-audio-video-${Date.now()}.mp4`);
    audioTempPath = path.join(os.tmpdir(), `extract-audio-audio-${Date.now()}.mp3`);

    await streamToFile(
      videoRes.body as unknown as import("stream/web").ReadableStream,
      videoTempPath
    );

    // 检查视频文件大小 — 如果太小，尝试 snssdk play URL 重试
    let videoStats = fs.statSync(videoTempPath);
    const videoTooSmall = videoStats.size < 10240; // 10KB 阈值

    if (videoTooSmall) {
      logger.warn(
        "extract-audio",
        `downloaded video too small (${videoStats.size} bytes), trying snssdk retry`
      );

      // 优先从 URL 中提取 video_id 构造 snssdk URL 重试。
      // 注：iesdouyin iteminfo 签名 API 现返回 11110(encrypt_data_miss) 已废弃，不再作为兜底；
      // 若 CDN URL 不含 video_id 则无法自动恢复，下方最终检查将返回 502（视频流为空）。
      const videoId = extractVideoId(targetUrl);
      if (videoId) {
        try {
          // 删除已被覆盖的旧临时文件，再重新分配路径
          if (fs.existsSync(videoTempPath)) fs.unlinkSync(videoTempPath);
          // 重新生成临时文件路径
          videoTempPath = path.join(os.tmpdir(), `extract-audio-video-${Date.now()}-v2.mp4`);

          const snssdkUrl = `https://aweme.snssdk.com/aweme/v1/play/?video_id=${videoId}&ratio=720p&line=0`;
          logger.info("extract-audio", `retrying with snssdk: ${snssdkUrl}`);

          const snssdkRes = await fetch(snssdkUrl, {
            headers: buildUpstreamHeaders(snssdkUrl),
            redirect: "follow",
          });

          if (snssdkRes.ok && snssdkRes.body) {
            await streamToFile(
              snssdkRes.body as unknown as import("stream/web").ReadableStream,
              videoTempPath
            );
            videoStats = fs.statSync(videoTempPath);
            logger.info("extract-audio", `snssdk retry downloaded ${videoStats.size} bytes`);
          }
        } catch (retryErr) {
          logger.error("extract-audio", "snssdk retry failed:", retryErr);
          if (fs.existsSync(videoTempPath)) fs.unlinkSync(videoTempPath);
        }
      }
    }

    // 最终检查视频文件大小
    if (videoStats.size < 10240) {
      return NextResponse.json(
        { ok: false, error: "下载的视频流为空，无法提取音频" },
        { status: 502 }
      );
    }

    // 调用 ffmpeg 提取音频（并发受信号量限制）
    await ffmpegSemaphore.acquire();
    try {
      await extractAudioWithFfmpeg(ffmpegPath, videoTempPath, audioTempPath);
    } finally {
      ffmpegSemaphore.release();
    }

    // 检查音频文件大小
    const audioStats = fs.statSync(audioTempPath);
    if (audioStats.size < 1024) {
      return NextResponse.json(
        { ok: false, error: "提取的音频文件为空，该视频可能没有音轨" },
        { status: 502 }
      );
    }

    // 读取音频文件并返回（读取完成后再清理临时文件）
    const audioBuffer = fs.readFileSync(audioTempPath);

    const responseHeaders = new Headers({
      "Content-Type": "audio/mpeg",
      "Content-Disposition": preview
        ? "inline"
        : `attachment; filename="${encodeURIComponent(filename)}"`,
      "Content-Length": String(audioStats.size),
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (err) {
    logger.error("extract-audio", "error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "音频提取失败" },
      { status: 500 }
    );
  } finally {
    // 所有路径统一清理临时文件（成功 / 早返回 / 异常）
    for (const p of [videoTempPath, audioTempPath]) {
      try {
        if (p && fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        // 忽略清理错误
      }
    }
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
 * 注：原 iesdouyin iteminfo 签名 API 兜底（getVideoIdFromApi / getDirectVideoUrl）
 * 现返回 status_code:11110(encrypt_data_miss) 已废弃，已移除。视频流过小且 CDN URL
 * 不含 video_id 时无法自动恢复，交由下方最终检查返回 502，不再静默重试失效 API。
 */

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
  try {
    const spec: string = "ffmpeg-static";
    const staticMod = (await import(/* @vite-ignore */ spec).catch(() => null)) as {
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

async function streamToFile(
  readableStream: import("stream/web").ReadableStream,
  filePath: string
): Promise<void> {
  const nodeStream = Readable.fromWeb(
    readableStream as unknown as import("stream/web").ReadableStream
  );
  const writeStream = fs.createWriteStream(filePath);

  return new Promise((resolve, reject) => {
    nodeStream.pipe(writeStream);
    nodeStream.on("error", reject);
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });
}

function extractAudioWithFfmpeg(
  ffmpegPath: string,
  videoPath: string,
  audioPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-i",
      videoPath,
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
      audioPath,
    ];

    const ffmpeg = spawn(ffmpegPath, args);
    const errorChunks: string[] = [];

    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      errorChunks.push(chunk.toString());
      if (errorChunks.join("").length > 50000) {
        errorChunks.shift();
      }
    });

    ffmpeg.on("error", (err) => {
      reject(err);
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const stderr = errorChunks.join("").slice(-1000);
        logger.error("extract-audio", `ffmpeg exited with code ${code}: ${stderr}`);
        reject(new Error(`ffmpeg 处理失败 (code ${code})`));
      }
    });

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
