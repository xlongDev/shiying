import { NextRequest, NextResponse } from "next/server";
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
 *   1. 下载短片视频流到临时文件
 *   2. 下载 BGM 音频流到临时文件
 *   3. 使用 ffmpeg 合并（视频流无损复制，音频 AAC 编码）
 *   4. 以音频时长为准截断视频（-shortest）
 *   5. 返回合并后的 MP4
 *   6. 清理临时文件
 *
 * 安全加固：
 *   - SSRF：videoUrl / audioUrl 经 isAllowedTarget 校验白名单 + 非内网 IP。
 *   - ffmpeg 并发受 ffmpegSemaphore 限制（最多 2 个），release 在 finally 中执行。
 *   - getFfmpegPath() 结果在模块作用域缓存，避免每次调用都重新探测。
 *   - 临时文件在所有返回 / 异常路径均由外层 finally 统一清理。
 */
// 模块级缓存：ffmpeg 探测结果只计算一次。
let cachedFfmpegPath: string | undefined;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const videoUrl = searchParams.get("videoUrl");
  const audioUrl = searchParams.get("audioUrl");
  const filename = searchParams.get("filename") || "live_compose.mp4";

  let videoTempPath = "";
  let audioTempPath = "";
  let outputTempPath = "";

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

  try {
    videoTempPath = path.join(os.tmpdir(), `live-video-${Date.now()}.mp4`);
    audioTempPath = path.join(os.tmpdir(), `live-audio-${Date.now()}.m4a`);
    outputTempPath = path.join(os.tmpdir(), `live-output-${Date.now()}.mp4`);

    // ---- Step 1: 下载视频流 ----
    console.log(`[live-compose] downloading video from: ${videoUrl.substring(0, 120)}`);
    const videoRes = await fetch(videoUrl, {
      headers: buildUpstreamHeaders(videoUrl),
      redirect: "follow",
    });

    if (!videoRes.ok || !videoRes.body) {
      logger.error("live-compose", `video download failed: HTTP ${videoRes.status}`);
      return NextResponse.json(
        { ok: false, error: `下载短片失败：HTTP ${videoRes.status}` },
        { status: 502 }
      );
    }

    await streamToFile(videoRes.body, videoTempPath);
    const videoSize = fs.statSync(videoTempPath).size;
    if (videoSize < 1024) {
      return NextResponse.json({ ok: false, error: "下载的短片文件为空" }, { status: 502 });
    }
    console.log(`[live-compose] video downloaded: ${(videoSize / 1024).toFixed(1)} KB`);

    // ---- Step 2: 下载音频流 ----
    console.log(`[live-compose] downloading audio from: ${audioUrl.substring(0, 120)}`);
    const audioRes = await fetch(audioUrl, {
      headers: buildUpstreamHeaders(audioUrl),
      redirect: "follow",
    });

    if (!audioRes.ok || !audioRes.body) {
      logger.error("live-compose", `audio download failed: HTTP ${audioRes.status}`);

      // 如果音频下载失败但视频成功，直接返回纯视频（无 BGM 合成）
      const videoBuffer = fs.readFileSync(videoTempPath);
      const respHeaders = new Headers({
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "Content-Length": String(videoSize),
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      return new NextResponse(videoBuffer, { status: 200, headers: respHeaders });
    }

    await streamToFile(audioRes.body, audioTempPath);
    const audioSize = fs.statSync(audioTempPath).size;
    if (audioSize < 1024) {
      // BGM 为空，返回纯视频
      const videoBuffer = fs.readFileSync(videoTempPath);
      const respHeaders = new Headers({
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "Content-Length": String(videoSize),
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      return new NextResponse(videoBuffer, { status: 200, headers: respHeaders });
    }
    console.log(`[live-compose] audio downloaded: ${(audioSize / 1024).toFixed(1)} KB`);

    // ---- Step 3: ffmpeg 合成（并发受信号量限制） ----
    // 视频流无损复制 (-c:v copy)，音频编码为 AAC，以音频时长为准
    await ffmpegSemaphore.acquire();
    try {
      await mergeWithFfmpeg(ffmpegPath, videoTempPath, audioTempPath, outputTempPath);
    } finally {
      ffmpegSemaphore.release();
    }

    const outputSize = fs.statSync(outputTempPath).size;
    if (outputSize < 1024) {
      return NextResponse.json(
        { ok: false, error: "合成产物为空，ffmpeg 处理失败" },
        { status: 500 }
      );
    }
    console.log(`[live-compose] output: ${(outputSize / 1024).toFixed(1)} KB`);

    // ---- Step 4: 返回结果 ----
    const outputBuffer = fs.readFileSync(outputTempPath);

    const respHeaders = new Headers({
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      "Content-Length": String(outputSize),
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });

    return new NextResponse(outputBuffer, { status: 200, headers: respHeaders });
  } catch (err) {
    logger.error("live-compose", "error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "实况合成失败" },
      { status: 500 }
    );
  } finally {
    // 所有路径统一清理临时文件（成功 / 早返回 / 异常）
    cleanUp(videoTempPath, audioTempPath, outputTempPath);
  }
}

/* ------------------------------------------------------------------ */
/* 辅助函数                                                            */
/* ------------------------------------------------------------------ */

function cleanUp(...paths: string[]) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
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

async function streamToFile(readableStream: ReadableStream, filePath: string): Promise<void> {
  const reader = readableStream.getReader();
  const writeStream = fs.createWriteStream(filePath);

  return new Promise((resolve, reject) => {
    function pump(): void {
      reader
        .read()
        .then(({ done, value }) => {
          if (done) {
            writeStream.end();
            resolve();
          } else if (value) {
            writeStream.write(Buffer.from(value));
            pump();
          }
        })
        .catch(reject);
    }
    pump();
    writeStream.on("error", reject);
  });
}

function mergeWithFfmpeg(
  ffmpegPath: string,
  videoPath: string,
  audioPath: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    // 视频流无损复制，音频编码为 AAC 128k，以音频时长为准截断
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
      "-y",
      outputPath,
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
