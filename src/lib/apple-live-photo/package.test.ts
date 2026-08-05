import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

vi.mock("../ssrf", () => ({ isAllowedTarget: vi.fn(async () => true) }));
vi.mock("../http", () => ({ fetchWithTimeout: vi.fn() }));
vi.mock("./ffmpeg", () => ({
  hasFfmpeg: vi.fn(() => false),
  resolveFfmpegBin: vi.fn(() => "ffmpeg"),
  runCommand: vi.fn(async () => undefined),
  buildImageToJpegArgs: vi.fn(() => []),
}));

import { createAppleLivePhotoPackage } from "./package";
import { fetchWithTimeout } from "../http";
import { hasFfmpeg } from "./ffmpeg";

const mockedFetch = vi.mocked(fetchWithTimeout);
const mockedHasFfmpeg = vi.mocked(hasFfmpeg);

/** 最小合法 JPEG：SOI + EOI。 */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
/** WebP 头（抖音现在下发的封面格式）。 */
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x10, 0, 0, 0]),
  Buffer.from("WEBPVP8 ", "latin1"),
]);

/** 合成一个含 ftyp + moov(mvhd) 的极简 MP4。 */
function minimalMp4(): Buffer {
  const ftyp = Buffer.alloc(16);
  ftyp.writeUInt32BE(16, 0);
  ftyp.write("ftyp", 4, "latin1");
  ftyp.write("isom", 8, "latin1");

  const mvhd = Buffer.alloc(12);
  mvhd.writeUInt32BE(12, 0);
  mvhd.write("mvhd", 4, "latin1");

  const moov = Buffer.alloc(8 + mvhd.length);
  moov.writeUInt32BE(moov.length, 0);
  moov.write("moov", 4, "latin1");
  mvhd.copy(moov, 8);

  return Buffer.concat([ftyp, moov]);
}

function respond(buf: Buffer) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  } as unknown as Response;
}

const UUID_RE = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/;

beforeEach(() => {
  vi.clearAllMocks();
  mockedHasFfmpeg.mockReturnValue(false);
});

describe("createAppleLivePhotoPackage", () => {
  it("客户端上传封面时不再下载 imageUrl，且无需 ffmpeg", async () => {
    mockedFetch.mockResolvedValue(respond(minimalMp4()));

    const { zipBuffer, filename } = await createAppleLivePhotoPackage({
      imageUrl: "https://cdn/cover.webp",
      videoUrl: "https://cdn/live.mp4",
      coverBuffer: JPEG,
      filename: "我的实况",
    });

    // 只拉了短片，封面走上传
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch.mock.calls[0]?.[0]).toBe("https://cdn/live.mp4");
    expect(filename).toBe("我的实况_apple_live_photo.zip");
    expect(zipBuffer.length).toBeGreaterThan(0);
  });

  it("产出 .pvt 目录结构，且 JPG / MOV 携带同一个 content identifier", async () => {
    mockedFetch.mockResolvedValue(respond(minimalMp4()));

    const { zipBuffer } = await createAppleLivePhotoPackage({
      imageUrl: "",
      videoUrl: "https://cdn/live.mp4",
      coverBuffer: JPEG,
    });

    const zip = await JSZip.loadAsync(zipBuffer);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    // 必须保留 .pvt 这层父目录，平铺三个散文件系统不认
    const pvtDir = names[0]?.split("/")[0] ?? "";
    expect(pvtDir).toMatch(/^IMG_[0-9A-F]{8}\.pvt$/);
    expect(names.sort()).toEqual([
      `${pvtDir}/${pvtDir.replace(".pvt", "")}.JPG`,
      `${pvtDir}/${pvtDir.replace(".pvt", "")}.MOV`,
      `${pvtDir}/metadata.plist`,
    ]);

    const base = pvtDir.replace(".pvt", "");
    const jpg = await zip.file(`${pvtDir}/${base}.JPG`)!.async("nodebuffer");
    const mov = await zip.file(`${pvtDir}/${base}.MOV`)!.async("nodebuffer");
    const plist = await zip.file(`${pvtDir}/metadata.plist`)!.async("string");

    const uuid = jpg.toString("latin1").match(UUID_RE)?.[0];
    expect(uuid).toBeTruthy();
    // 配对的关键：两个文件里是同一个 UUID
    expect(mov.toString("latin1")).toContain(uuid!);
    expect(mov.toString("latin1")).toContain("com.apple.quicktime.content.identifier");
    expect(jpg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(plist).toContain("PFVideoComplementMetadataVersionKey");
  });

  it("没有上传封面且下发 WebP、又没有 ffmpeg 时，给出可行动的报错", async () => {
    mockedFetch.mockImplementation(async (url: string) =>
      respond(url.includes("cover") ? WEBP : minimalMp4())
    );

    await expect(
      createAppleLivePhotoPackage({
        imageUrl: "https://cdn/cover.webp",
        videoUrl: "https://cdn/live.mp4",
      })
    ).rejects.toThrow(/浏览器端转码未生效|FFMPEG_PATH/);
  });

  it("没上传封面时才会去下载 imageUrl", async () => {
    mockedFetch.mockImplementation(async (url: string) =>
      respond(url.includes("cover") ? JPEG : minimalMp4())
    );

    await createAppleLivePhotoPackage({
      imageUrl: "https://cdn/cover.jpg",
      videoUrl: "https://cdn/live.mp4",
    });

    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });
});
