// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { looksLikeJpeg, encodeBlobToJpeg, fetchCoverAsJpeg } from "./image-to-jpeg";

const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const WEBP_HEAD = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // "RIFF"

/** 替换 document.createElement("canvas")，返回可断言的假画布。 */
function stubCanvas(out: Blob | null) {
  const ctx = {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toBlob: vi.fn((cb: (b: Blob | null) => void) => cb(out)),
  };
  const original = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
    tag === "canvas" ? canvas : original(tag)) as typeof document.createElement);
  return { canvas, ctx };
}

/**
 * 假的 fetch 响应。
 * 不用真的 `Response`：jsdom 的 Blob 与 undici 的 Response 不兼容
 * （undici 会去调 blob.stream()），这里只需要 ok/status/blob 三个字段。
 */
function stubFetch(blob: Blob, status = 200) {
  const mock = vi.fn(async (url: string) => {
    void url; // 仅为让 mock.calls 带上入参类型，便于断言请求地址
    return { ok: status >= 200 && status < 300, status, blob: async () => blob };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("looksLikeJpeg", () => {
  it("识别 JPEG 魔数 FF D8 FF", () => {
    expect(looksLikeJpeg(JPEG_HEAD)).toBe(true);
  });

  it("WebP / 空数据不算 JPEG", () => {
    expect(looksLikeJpeg(WEBP_HEAD)).toBe(false);
    expect(looksLikeJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false); // 长度不足
    expect(looksLikeJpeg(new Uint8Array())).toBe(false);
  });
});

describe("encodeBlobToJpeg", () => {
  it("解码后铺白底再画，并按 image/jpeg 导出", async () => {
    const bitmap = { width: 1080, height: 1920, close: vi.fn() };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmap)
    );
    const expected = new Blob([JPEG_HEAD], { type: "image/jpeg" });
    const { canvas, ctx } = stubCanvas(expected);

    const out = await encodeBlobToJpeg(new Blob([WEBP_HEAD], { type: "image/webp" }));

    expect(out).toBe(expected);
    expect(canvas.width).toBe(1080);
    expect(canvas.height).toBe(1920);
    // JPEG 无透明通道，必须先铺白底再画，否则透明区域会变黑
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1080, 1920);
    expect(ctx.fillStyle).toBe("#ffffff");
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.95);
    // ImageBitmap 用完要释放
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("toBlob 返回 null 时抛错，且仍释放位图", async () => {
    const bitmap = { width: 10, height: 10, close: vi.fn() };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmap)
    );
    stubCanvas(null);

    await expect(encodeBlobToJpeg(new Blob([WEBP_HEAD]))).rejects.toThrow("canvas 导出 JPEG 失败");
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("尺寸为 0 的图片直接报错", async () => {
    const bitmap = { width: 0, height: 0, close: vi.fn() };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmap)
    );
    stubCanvas(new Blob([JPEG_HEAD]));

    await expect(encodeBlobToJpeg(new Blob([WEBP_HEAD]))).rejects.toThrow("图片尺寸无效");
  });
});

describe("fetchCoverAsJpeg", () => {
  it("已经是 JPEG 时原样返回，不重编码", async () => {
    const jpeg = new Blob([JPEG_HEAD], { type: "image/jpeg" });
    stubFetch(jpeg);
    const createBitmap = vi.fn();
    vi.stubGlobal("createImageBitmap", createBitmap);

    await expect(fetchCoverAsJpeg("https://cdn/a.jpg")).resolves.toBe(jpeg);
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it("WebP 封面会走 canvas 转成 JPEG", async () => {
    stubFetch(new Blob([WEBP_HEAD], { type: "image/webp" }));
    const bitmap = { width: 4, height: 4, close: vi.fn() };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmap)
    );
    const expected = new Blob([JPEG_HEAD], { type: "image/jpeg" });
    stubCanvas(expected);

    await expect(fetchCoverAsJpeg("https://cdn/a.webp")).resolves.toBe(expected);
  });

  it("经同源 /api/proxy-media 拉取，避免 canvas 被跨域污染", async () => {
    const fetchMock = stubFetch(new Blob([JPEG_HEAD], { type: "image/jpeg" }));

    await fetchCoverAsJpeg("https://cdn/a.jpg?x=1");

    const called = String(fetchMock.mock.calls[0]?.[0]);
    expect(called.startsWith("/api/proxy-media?url=")).toBe(true);
    expect(called).toContain(encodeURIComponent("https://cdn/a.jpg?x=1"));
  });

  it("下载失败时抛出可读错误", async () => {
    stubFetch(new Blob([JPEG_HEAD]), 403);
    await expect(fetchCoverAsJpeg("https://cdn/a.webp")).rejects.toThrow(
      "封面下载失败（HTTP 403）"
    );
  });
});
