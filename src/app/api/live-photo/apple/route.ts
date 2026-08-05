import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/rate-limit-guard";
import { logger } from "@/lib/logger";
import { createAppleLivePhotoPackage, getAppleLivePhotoCapability } from "@/lib/apple-live-photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
/** 客户端上传封面的体积上限，防止被当成任意文件中转。 */
const MAX_COVER_BYTES = 20 * 1024 * 1024;

interface ApplePayload {
  imageUrl: string;
  videoUrl: string;
  filename?: string;
  /** 浏览器端已转好的 JPEG 封面；有它就不用服务端再下载 / 转码。 */
  coverBuffer?: Buffer;
}

/**
 * 同时支持两种请求体：
 *  - multipart/form-data：浏览器走这条，可带上 canvas 转好的 JPEG 封面（无需 ffmpeg）
 *  - application/json：脚本 / 老客户端走这条，封面由服务端下载
 */
async function readPayload(req: NextRequest): Promise<ApplePayload | null> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const str = (key: string): string => {
      const v = form.get(key);
      return typeof v === "string" ? v : "";
    };
    const cover = form.get("cover");
    let coverBuffer: Buffer | undefined;
    if (cover && typeof cover !== "string" && cover.size > 0 && cover.size <= MAX_COVER_BYTES) {
      const buf = Buffer.from(await cover.arrayBuffer());
      // 按魔数校验，不信任 Content-Type；非 JPEG 就丢弃，退回服务端自行下载 imageUrl
      if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
        coverBuffer = buf;
      }
    }
    return {
      imageUrl: str("imageUrl"),
      videoUrl: str("videoUrl"),
      filename: str("filename") || undefined,
      coverBuffer,
    };
  }

  const body = (await req.json()) as Record<string, unknown>;
  return {
    imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : "",
    videoUrl: typeof body.videoUrl === "string" ? body.videoUrl : "",
    filename: typeof body.filename === "string" ? body.filename : undefined,
  };
}

/**
 * 错误脱敏：
 *  - 打包层显式标记 `userFacing` 的文案是可行动提示，原样透出（不含内部细节）
 *  - SSRF 一律收敛成统一文案，避免回显内网地址
 *  - 其余（网络抖动、CDN 403、磁盘等）给通用重试提示
 * 这里用鸭子类型判断而非 instanceof，避免把打包实现拽进路由的模块图。
 */
function toClientMessage(err: unknown): string {
  if (err instanceof Error) {
    if ((err as { userFacing?: unknown }).userFacing === true) return err.message;
    if (err.message.includes("SSRF")) return "资源地址不合法";
  }
  return "实况照片打包失败，请稍后重试";
}

/**
 * 打包苹果实况照片（Apple Live Photo / .pvt）。
 *
 * GET  /api/live-photo/apple  → 能力探测：{ available }
 *      available 恒为 true（纯 Node 实现，零外部依赖）。
 * POST /api/live-photo/apple
 *      body: { imageUrl, videoUrl, filename?, cover? }
 *      返回：ZIP（内含 .pvt 目录），Content-Disposition 带文件名。
 */
export async function GET() {
  const cap = getAppleLivePhotoCapability();
  return NextResponse.json({ available: cap.available });
}

export async function POST(req: NextRequest) {
  const blocked = await guardRateLimit(req, "apple-live-photo", RATE_LIMIT, RATE_WINDOW_MS);
  if (blocked) return blocked;

  const cap = getAppleLivePhotoCapability();
  if (!cap.available) {
    return NextResponse.json(
      { ok: false, error: `当前环境不支持保存苹果实况照片：${cap.reason ?? "缺少依赖"}` },
      { status: 503 }
    );
  }

  let payload: ApplePayload | null = null;
  try {
    payload = await readPayload(req);
  } catch {
    return NextResponse.json({ ok: false, error: "请求体非法" }, { status: 400 });
  }
  if (!payload) {
    return NextResponse.json({ ok: false, error: "请求体非法" }, { status: 400 });
  }

  // 封面可以由客户端直接上传（此时 imageUrl 只作兜底）。两者至少要各有一个。
  if (!payload.videoUrl || (!payload.imageUrl && !payload.coverBuffer)) {
    return NextResponse.json(
      { ok: false, error: "缺少 imageUrl 或 videoUrl 参数" },
      { status: 400 }
    );
  }

  try {
    const { zipBuffer, filename } = await createAppleLivePhotoPackage({
      imageUrl: payload.imageUrl,
      videoUrl: payload.videoUrl,
      filename: payload.filename,
      coverBuffer: payload.coverBuffer,
    });

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "Content-Length": String(zipBuffer.length),
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    logger.error("apple-live-photo", "打包失败:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: toClientMessage(err) }, { status: 500 });
  }
}
