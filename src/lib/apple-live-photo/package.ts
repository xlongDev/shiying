/**
 * 苹果实况照片（Apple Live Photo / .pvt）端到端打包 —— 零外部依赖。
 *
 * 配对原理：静帧与短片各自携带**同一个 content identifier（UUID）**，
 * 系统据此把两个文件识别成一张实况照片。两侧的写入都在纯 Node 中完成：
 *   - JPG：EXIF → MakerNote → Apple tag 0x0011（jpeg-content-id.ts）
 *   - MOV：moov/meta → keys/ilst → com.apple.quicktime.content.identifier
 *          （mov-content-id.ts）
 * 已用 macOS 的 ImageIO / AVFoundation / PHLivePhoto 实测通过配对。
 *
 * 产物是一个 `.pvt` 包（对齐 makelive 的 `save_live_photo_pair_as_pvt`）：
 *   IMG_xxxx.pvt/
 *     ├─ IMG_xxxx.JPG
 *     ├─ IMG_xxxx.MOV
 *     └─ metadata.plist   （PFVideoComplementMetadataVersionKey = 1）
 * ZIP 里**保留 .pvt 这层父目录**（等价于 `ditto --keepParent`），解压后才是
 * 一个可直接拖进「照片」的包；平铺成三个散文件是不行的。
 *
 * 抖音 MP4 本身就是 H.264 + AAC，与实况短片要求一致，因此直接直通为 .MOV，
 * 不转码、不掉画质。ffmpeg 只在「封面非 JPEG」时才作为兜底转码用到。
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { fetchWithTimeout } from "../http";
import { buildUpstreamHeaders } from "../cdn";
import { isAllowedTarget } from "../ssrf";
import { sanitizeFilename } from "../media-url";
import { isJpeg, writeJpegContentIdentifier } from "./jpeg-content-id";
import { writeMovContentIdentifier } from "./mov-content-id";
import { buildImageToJpegArgs, hasFfmpeg, resolveFfmpegBin, runCommand } from "./ffmpeg";

export interface AppleLivePhotoInput {
  /** 静帧原图 CDN URL。若提供了 coverBuffer，此项仅作兜底。 */
  imageUrl: string;
  /**
   * 已就绪的封面字节（通常是浏览器用 canvas 把 WebP 转好的 JPEG）。
   * 给了就不再走网络下载，也就不需要 ffmpeg 转码。
   */
  coverBuffer?: Buffer;
  /** 动态短片 CDN URL（MP4）。 */
  videoUrl: string;
  /** 下载文件名基底（不含扩展名）。 */
  filename?: string;
}

export interface AppleLivePhotoResult {
  /** 打包好的 ZIP（内含 .pvt 目录）。 */
  zipBuffer: Buffer;
  /** 建议的下载文件名。 */
  filename: string;
}

export interface AppleLivePhotoCapability {
  available: boolean;
  /** 不可用时的人类可读原因。 */
  reason?: string;
}

/** `.pvt` 包内的元数据文件内容（对齐 makelive）。 */
export const PVT_METADATA_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>PFVideoComplementMetadataVersionKey</key>
\t<string>1</string>
</dict>
</plist>
`;

/** 打包能力：纯 Node 实现，始终可用（零外部依赖）。 */
export function getAppleLivePhotoCapability(): AppleLivePhotoCapability {
  return { available: true };
}

/** 带此标记的错误文案是「用户可行动」的，允许原样回给前端；其余一律脱敏。 */
export interface UserFacingError extends Error {
  userFacing: true;
}

export function isUserFacingError(err: unknown): err is UserFacingError {
  return err instanceof Error && (err as Partial<UserFacingError>).userFacing === true;
}

function userError(message: string): UserFacingError {
  return Object.assign(new Error(message), { userFacing: true as const });
}

async function downloadBinary(url: string): Promise<Buffer> {
  const res = await fetchWithTimeout(url, { headers: buildUpstreamHeaders(url) });
  if (!res.ok) {
    throw new Error(`资源下载失败：HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * 封面若不是 JPEG（抖音现在统一下发 WebP），在有 ffmpeg 时转码。
 * 正常路径下浏览器已用 canvas 转好并上传，这里只是兜底。
 */
async function ensureJpegCover(cover: Buffer, workDir: string): Promise<Buffer> {
  if (isJpeg(cover)) return cover;
  if (!hasFfmpeg()) {
    throw userError(
      "封面不是 JPEG（抖音下发 WebP），浏览器端转码未生效；请换用支持 canvas 的现代浏览器重试，或在服务端安装 ffmpeg / 设置 FFMPEG_PATH"
    );
  }
  const src = join(workDir, "cover.src");
  const out = join(workDir, "cover.jpg");
  writeFileSync(src, cover);
  await runCommand(resolveFfmpegBin(), buildImageToJpegArgs({ input: src, out }));
  return readFileSync(out);
}

/**
 * 端到端打包苹果实况照片。
 * 1) SSRF 校验上游地址；2) 拉取封面 / 短片；
 * 3) 双向写入同一个 content identifier；4) 组装 .pvt 目录并打成 ZIP。
 */
export async function createAppleLivePhotoPackage(
  input: AppleLivePhotoInput
): Promise<AppleLivePhotoResult> {
  // 客户端已上传的封面不再走网络下载，无需纳入 SSRF 校验
  const urls = [input.coverBuffer ? undefined : input.imageUrl, input.videoUrl].filter(
    (u): u is string => typeof u === "string" && u.length > 0
  );
  for (const url of urls) {
    if (!(await isAllowedTarget(url))) {
      throw new Error("资源地址不合法（SSRF 防护）");
    }
  }

  const workDir = mkdtempSync(join(tmpdir(), "apple-lp-"));
  const [rawCover, rawVideo] = await Promise.all([
    input.coverBuffer ? Promise.resolve(input.coverBuffer) : downloadBinary(input.imageUrl),
    downloadBinary(input.videoUrl),
  ]);

  const cover = await ensureJpegCover(rawCover, workDir);
  const video = rawVideo;

  // 关键：两个文件写入同一个 UUID，系统据此配对
  const assetId = randomUUID().toUpperCase();
  const base = `IMG_${assetId.replace(/-/g, "").slice(0, 8)}`;
  const taggedJpg = writeJpegContentIdentifier(cover, assetId);
  const taggedMov = writeMovContentIdentifier(video, assetId);

  const zip = new JSZip();
  const pvt = zip.folder(`${base}.pvt`);
  if (!pvt) throw new Error("创建 .pvt 目录失败");
  pvt.file(`${base}.JPG`, taggedJpg);
  pvt.file(`${base}.MOV`, taggedMov);
  pvt.file("metadata.plist", PVT_METADATA_PLIST);
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  const baseName = sanitizeFilename(input.filename || "live_photo");
  return { zipBuffer, filename: `${baseName}_apple_live_photo.zip` };
}
