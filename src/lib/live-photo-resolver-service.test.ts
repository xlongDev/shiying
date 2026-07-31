import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveLivePhotosViaService } from "./live-photo-resolver";

const savedEnv = { ...process.env };
const savedFetch = global.fetch;

afterEach(() => {
  process.env = { ...savedEnv };
  global.fetch = savedFetch;
});

describe("resolveLivePhotosViaService（国内服务转发桥）", () => {
  it("未配置 LIVE_PHOTO_SERVICE_URL 时直接返回 []", async () => {
    delete process.env.LIVE_PHOTO_SERVICE_URL;
    const r = await resolveLivePhotosViaService("12345");
    expect(r).toEqual([]);
  });

  it("携带 Bearer Token 转发并解析 livePhotos", async () => {
    process.env.LIVE_PHOTO_SERVICE_URL = "https://svc.example.com/";
    process.env.LIVE_PHOTO_SERVICE_TOKEN = "secret-token";
    const fetchMock = vi.fn(async (u: any, init: any) => {
      expect(String(u)).toContain("/parse-live-photo?awemeId=12345");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret-token");
      return new Response(
        JSON.stringify({
          ok: true,
          livePhotos: [{ index: 0, imageUrl: "i", videoUrl: "v" }],
        }),
        { status: 200 }
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await resolveLivePhotosViaService("12345");
    expect(r).toEqual([{ index: 0, imageUrl: "i", videoUrl: "v" }]);
  });

  it("服务返回非 ok / 异常时返回 []（回退兜底）", async () => {
    process.env.LIVE_PHOTO_SERVICE_URL = "https://svc.example.com";
    global.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const r = await resolveLivePhotosViaService("12345");
    expect(r).toEqual([]);
  });

  it("服务返回 500 时返回 []", async () => {
    process.env.LIVE_PHOTO_SERVICE_URL = "https://svc.example.com";
    global.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, error: "x" }), {
        status: 500,
      })) as unknown as typeof fetch;

    const r = await resolveLivePhotosViaService("12345");
    expect(r).toEqual([]);
  });
});
