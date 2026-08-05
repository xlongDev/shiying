import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// 整个模块被 mock，避免真实下载 / spawn ffmpeg
vi.mock("@/lib/apple-live-photo", () => ({
  getAppleLivePhotoCapability: vi.fn(),
  createAppleLivePhotoPackage: vi.fn(),
}));

import { GET, POST } from "./route";
import { getAppleLivePhotoCapability, createAppleLivePhotoPackage } from "@/lib/apple-live-photo";

const mockedCap = vi.mocked(getAppleLivePhotoCapability);
const mockedCreate = vi.mocked(createAppleLivePhotoPackage);

function makeReq(ip: string, body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/live-photo/apple", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

/** 浏览器走的 multipart 请求：可携带 canvas 转好的 JPEG 封面。 */
function makeFormReq(ip: string, fields: Record<string, string>, cover?: Blob): NextRequest {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (cover) form.append("cover", cover, "cover.jpg");
  return new NextRequest("http://localhost/api/live-photo/apple", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: form,
  });
}

const ZIP = Buffer.from("PK\x03\x04 fake-zip-bytes");
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe("GET /api/live-photo/apple", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCap.mockReturnValue({ available: true });
  });

  it("始终返回 available=true（纯 Node 实现，零外部依赖）", async () => {
    const body = await (await GET()).json();
    expect(body).toEqual({ available: true });
  });
});

describe("POST /api/live-photo/apple", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCap.mockReturnValue({ available: true });
    mockedCreate.mockResolvedValue({
      zipBuffer: ZIP,
      filename: "demo_apple_live_photo.zip",
    });
  });

  it("缺少 imageUrl / videoUrl 时返回 400", async () => {
    const res = await POST(makeReq("apple-it-1", { imageUrl: "http://x/a.jpg" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("缺少 videoUrl 时返回 400（封面可有可无）", async () => {
    const res = await POST(makeReq("apple-it-1b", { imageUrl: "http://x/a.jpg" }));
    expect(res.status).toBe(400);
  });

  it("能力缺失时返回 503 并说明原因", async () => {
    mockedCap.mockReturnValue({
      available: false,
      reason: "运行环境不支持写入临时文件",
    });
    const res = await POST(
      makeReq("apple-it-2", {
        imageUrl: "http://x/a.jpg",
        videoUrl: "http://x/b.mp4",
      })
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("运行环境不支持写入临时文件");
  });

  it("能力就绪时返回 ZIP 并带下载文件名", async () => {
    const res = await POST(
      makeReq("apple-it-3", {
        imageUrl: "http://x/a.jpg",
        videoUrl: "http://x/b.mp4",
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain("demo_apple_live_photo.zip");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(ZIP)).toBe(true);
  });

  it("SSRF 拦截时返回 500 且不泄漏内部信息", async () => {
    mockedCreate.mockRejectedValue(new Error("SSRF blocked: 127.0.0.1"));
    const res = await POST(
      makeReq("apple-it-6", {
        imageUrl: "http://127.0.0.1/a.jpg",
        videoUrl: "http://127.0.0.1/b.mp4",
      })
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("资源地址不合法");
    expect(body.error).not.toContain("127.0.0.1");
  });

  it("标记 userFacing 的错误原样透出，便于用户自助解决", async () => {
    mockedCreate.mockRejectedValue(
      Object.assign(new Error("封面不是 JPEG（抖音下发 WebP），浏览器端转码未生效"), {
        userFacing: true,
      })
    );
    const res = await POST(
      makeReq("apple-it-7", { imageUrl: "http://x/a.webp", videoUrl: "http://x/b.mp4" })
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("浏览器端转码未生效");
  });

  it("未标记的内部错误统一脱敏", async () => {
    mockedCreate.mockRejectedValue(new Error("ENOSPC: no space left on device, write '/tmp/x'"));
    const res = await POST(
      makeReq("apple-it-8", { imageUrl: "http://x/a.jpg", videoUrl: "http://x/b.mp4" })
    );
    const body = await res.json();
    expect(body.error).toBe("实况照片打包失败，请稍后重试");
    expect(body.error).not.toContain("/tmp/x");
  });

  it("非法 JSON 请求体返回 400", async () => {
    const res = await new NextRequest("http://localhost/api/live-photo/apple", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "apple-it-4" },
      body: "not-json",
    });
    expect((await POST(res)).status).toBe(400);
  });
});

// 浏览器把 WebP 封面用 canvas 转成 JPEG 后随表单上传，服务端就不必依赖 ffmpeg
describe("POST /api/live-photo/apple（multipart 上传封面）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCap.mockReturnValue({ available: true });
    mockedCreate.mockResolvedValue({
      zipBuffer: ZIP,
      filename: "demo_apple_live_photo.zip",
    });
  });

  it("把上传的封面字节透传给打包函数", async () => {
    const cover = new Blob([JPEG_BYTES], { type: "image/jpeg" });
    const res = await POST(
      makeFormReq(
        "apple-mp-1",
        {
          imageUrl: "http://x/a.webp",
          videoUrl: "http://x/b.mp4",
        },
        cover
      )
    );

    expect(res.status).toBe(200);
    const arg = mockedCreate.mock.calls[0]?.[0];
    expect(arg?.coverBuffer).toBeInstanceOf(Buffer);
    expect(Uint8Array.from(arg!.coverBuffer!)).toEqual(JPEG_BYTES);
  });

  it("有上传封面时即使没有 imageUrl 也放行", async () => {
    const res = await POST(
      makeFormReq(
        "apple-mp-2",
        { videoUrl: "http://x/b.mp4" },
        new Blob([JPEG_BYTES], { type: "image/jpeg" })
      )
    );
    expect(res.status).toBe(200);
  });

  it("没有封面也没有 imageUrl 时返回 400", async () => {
    const res = await POST(makeFormReq("apple-mp-3", { videoUrl: "http://x/b.mp4" }));
    expect(res.status).toBe(400);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("超大封面被丢弃，退回服务端自行下载", async () => {
    const huge = new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: "image/jpeg" });
    await POST(
      makeFormReq("apple-mp-5", { imageUrl: "http://x/a.webp", videoUrl: "http://x/b.mp4" }, huge)
    );
    expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({ coverBuffer: undefined }));
  });

  it("上传内容魔数不是 JPEG 时丢弃（不信任 Content-Type）", async () => {
    const fake = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: "image/jpeg" });
    await POST(
      makeFormReq("apple-mp-6", { imageUrl: "http://x/a.webp", videoUrl: "http://x/b.mp4" }, fake)
    );
    expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({ coverBuffer: undefined }));
  });
});
