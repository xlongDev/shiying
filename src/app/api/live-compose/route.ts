import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/rate-limit-guard";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { ffmpegSemaphore } from "@/lib/concurrency";
import { logger } from "@/lib/logger";
import { isAllowedTarget } from "@/lib/ssrf";
import { buildUpstreamHeaders } from "@/lib/cdn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 实况照片合成 API：将动态短片与 BGM 音频合并为完整带音乐视频
 *
 * 用法：GET /api/live-compose?videoUrl=xxx&audioUrl=xxx&filename=xxx
 *
 * 流程：
 *   1. 下载短片 / BGM 到内存 Buffer
 *   2. 将两者写入临时文件（仅写出，不读回）供 ffmpeg 作 -i 输入
 *   3. ffmpeg 合并，输出直接走 stdout pipe:1（不落盘、不读回）
 *   4. 返回合并后的 MP4
 *   5. 清理临时文件
 *
 * 安全加固：
 *   - SSRF：videoUrl / audioUrl 经 isAllowedTarget 校验白名单 + 非内网 IP。
 *   - ffmpeg 并发受 ffmpegSemaphore 限制（最多 2 个），release 在 finally 中执行。
 *   - getFfmpegPath() 结果在模块作用域缓存，避免每次调用都重新探测。
 *   - 全程避免对动态路径的 fs 读取（statSync / readFileSync / existsSync），
 *     仅保留必要的写出（createWriteStream / writeFileSync）与删除（unlinkSync），
 *     以规避 Next/Turbopack 构建期 NFT 全目录追踪告警。
 */
// 模块级缓存：ffmpeg 探测结果只计算一次。
let cachedFfmpegPath: string | undefined;

export async function GET(req: NextRequest) {
  const blocked = await guardRateLimit(req, "live-compose", 10, 60_000);
  if (blocked) return blocked;

  const { searchParams } = new URL(req.url);
  const videoUrl = searchParams.get("videoUrl");
  const audioUrl = searchParams.get("audioUrl");
  const filename = searchParams.get("filename") || "live_compose.mp4";
  const preview = searchParams.get("preview") === "1";

  if (!videoUrl || !audioUrl) {
    return NextResponse.json(
      { ok: false, error: "缺少 videoUrl 或 audioUrl 参数" },
      { status: 400 }
    );
  }

  // SSRF：videoUrl / audioUrl 均为用户传入的上游地址，须校验白名单 + 非内网 IP。
  if (!(await isAllowedTarget(videoUrl)) || !(await isAllowedTarget(audioUrl))) {
    return NextResponse.json({ ok: false, error: "禁止访问该地址" }, { status: 403 });
  }

  // 查找 ffmpeg（结果已缓存）
  const ffmpegPath = await getFfmpegPath();
  if (!ffmpegPath) {
    return NextResponse.json(
      { ok: false, error: "服务器未安装 ffmpeg，无法合成视频" },
      { status: 501 }
    );
  }

  // 临时文件仅用于 ffmpeg 输入（写出，无读回），不触发 NFT 读取追踪。
  const videoTempPath = path.join(
    /*turbopackIgnore: true*/ os.tmpdir(),
    `live-video-${Date.now()}.mp4`
  );
  const audioTempPath = path.join(
    /*turbopackIgnore: true*/ os.tmpdir(),
    `live-audio-${Date.now()}.m4a`
  );

  try {
    // ---- Step 1: 下载视频流为内存 Buffer ----
    logger.info("live-compose", `downloading video from: ${videoUrl.substring(0, 120)}`);
    const videoBuffer = await downloadToBuffer(videoUrl);
    if (!videoBuffer || videoBuffer.byteLength < 1024) {
      return NextResponse.json({ ok: false, error: "下载的短片文件为空" }, { status: 502 });
    }
    logger.info(
      "live-compose",
      `video downloaded: ${(videoBuffer.byteLength / 1024).toFixed(1)} KB`
    );

    // ---- Step 2: 下载音频流为内存 Buffer ----
    logger.info("live-compose", `downloading audio from: ${audioUrl.substring(0, 120)}`);
    const audioBuffer = await downloadToBuffer(audioUrl);

    // 音频缺失或为空 → 直接返回纯视频（无 BGM 合成）
    if (!audioBuffer || audioBuffer.byteLength < 1024) {
      logger.warn("live-compose", "BGM 为空，返回纯视频");
      return bufferResponse(videoBuffer, "video/mp4", filename, preview);
    }
    logger.info(
      "live-compose",
      `audio downloaded: ${(audioBuffer.byteLength / 1024).toFixed(1)} KB`
    );

    // 写入临时文件供 ffmpeg 作 -i 输入（仅写出）
    fs.writeFileSync(videoTempPath, videoBuffer);
    fs.writeFileSync(audioTempPath, audioBuffer);

    // ---- Step 3: ffmpeg 合成（并发受信号量限制，输出走 stdout pipe:1）----
    // 视频流无损复制 (-c:v copy)，音频编码为 AAC，以音频时长为准
    await ffmpegSemaphore.acquire();
    let outputBuffer: Buffer;
    try {
      outputBuffer = await mergeWithFfmpeg(ffmpegPath, videoTempPath, audioTempPath);
    } finally {
      ffmpegSemaphore.release();
    }

    if (outputBuffer.byteLength < 1024) {
      return NextResponse.json(
        { ok: false, error: "合成产物为空，ffmpeg 处理失败" },
        { status: 500 }
      );
    }
    logger.info("live-compose", `output: ${(outputBuffer.byteLength / 1024).toFixed(1)} KB`);

    // ---- Step 4: 返回结果 ----
    return bufferResponse(outputBuffer, "video/mp4", filename, preview);
  } catch (err) {
    logger.error("live-compose", "error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "实况合成失败" },
      { status: 500 }
    );
  } finally {
    // 所有路径统一清理临时文件（成功 / 早返回 / 异常）
    cleanUp(videoTempPath, audioTempPath);
  }
}

/* ------------------------------------------------------------------ */
/* 辅助函数                                                            */
/* ------------------------------------------------------------------ */

function bufferResponse(
  buffer: Buffer,
  contentType: string,
  filename: string,
  preview: boolean
): NextResponse {
  const respHeaders = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": preview
      ? "inline"
      : `attachment; filename="${encodeURIComponent(filename)}"`,
    "Content-Length": String(buffer.byteLength),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  return new NextResponse(new Uint8Array(buffer), { status: 200, headers: respHeaders });
}

/** 下载上游流为内存 Buffer（含非视频内容类型拦截）。 */
async function downloadToBuffer(rawUrl: string): Promise<Buffer | null> {
  const res = await fetch(rawUrl, {
    headers: buildUpstreamHeaders(rawUrl),
    redirect: "follow",
  });
  if (!res.ok || !res.body) return null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("json") || contentType.includes("html")) return null;
  return Buffer.from(await res.arrayBuffer());
}

function cleanUp(...paths: string[]) {
  for (const p of paths) {
    try {
      // unlink（删除）不属于读取，不触发 NFT 追踪
      fs.unlinkSync(p);
    } catch {
      // 忽略清理错误
    }
  }
}

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

function mergeWithFfmpeg(
  ffmpegPath: string,
  videoPath: string,
  audioPath: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // 视频流无损复制，音频编码为 AAC 128k，以音频时长为准截断；输出走 stdout pipe:1
    const args = [
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-c:v",
      "copy", // 视频流无损复制
      "-c:a",
      "aac", // 音频 AAC 编码
      "-b:a",
      "128k",
      "-shortest", // 以较短流（音频）为准
      "-map",
      "0:v:0", // 取第一个输入的视频流
      "-map",
      "1:a:0", // 取第二个输入的音频流
      "-f",
      "mp4",
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
        logger.error("live-compose", `ffmpeg exited with code ${code}: ${stderr}`);
        reject(new Error(`ffmpeg 合成失败 (code ${code})`));
      }
    });

    setTimeout(() => {
      try {
        ffmpeg.kill();
      } catch {
        /* ignore */
      }
      reject(new Error("ffmpeg 合成超时"));
    }, 240000);
  });
}
