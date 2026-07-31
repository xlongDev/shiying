import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveLivePhotoVideoUrl } from "./live-photo-resolver";

// 桩掉 chrome-finder，避免测试环境（无系统 Chrome）走无头浏览器回退时
// spawnSync(which chrome) 卡住。纯 API 路径的回归验证不依赖浏览器。
vi.mock("./chrome-finder", () => ({
  findChromeExecutable: vi.fn(async () => null),
}));

/**
 * 纯 API 实况解析路径的回归测试。
 * 通过 mock 全局 fetch 拦截 iesdouyin iteminfo，验证：
 *  - API 返回含 live_photo 的图片时，能从 video.bitRateList[0].playAddr 提取 douyinvod 短片 URL
 *  - API 无实况时返回 null（且不触发无头浏览器，测试环境无 Chrome）
 */
function mockIteminfo(item: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("iesdouyin.com/web/api/v2/aweme/iteminfo")) {
        return new Response(JSON.stringify({ item_list: [item] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 404 });
    })
  );
}

describe("resolveLivePhotoVideoUrl (pure API path)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // 确保浏览器回退不会真的启动 Chrome（测试环境无系统 Chrome）
    vi.stubEnv("DISABLE_LIVE_PHOTO_RESOLVE", "");
  });

  it("extracts live photo video url from iteminfo API", async () => {
    mockIteminfo({
      images: [
        {
          url_list: ["https://p1.douyinpic.com/abc.jpg"],
          live_photo: true,
          video: {
            bitRateList: [{ playAddr: [{ src: "https://v3-dy-z.douyinvod.com/short/xyz.mp4" }] }],
          },
        },
      ],
    });

    const url = await resolveLivePhotoVideoUrl("123456");
    expect(url).toContain("douyinvod");
    expect(url).toBe("https://v3-dy-z.douyinvod.com/short/xyz.mp4");
  });

  it("recognizes livePhotoType===1 as live photo", async () => {
    mockIteminfo({
      images: [
        {
          url_list: ["https://p1.douyinpic.com/abc.jpg"],
          livePhotoType: 1,
          video: {
            bitRateList: [{ playAddr: [{ src: "https://v26-dy.douyinvod.com/lp.mp4" }] }],
          },
        },
      ],
    });

    const url = await resolveLivePhotoVideoUrl("999");
    expect(url).toContain("douyinvod");
  });

  it("returns null when API returns no live photo", async () => {
    mockIteminfo({
      images: [{ url_list: ["https://p1.douyinpic.com/normal.jpg"] }],
    });

    const url = await resolveLivePhotoVideoUrl("123");
    expect(url).toBeNull();
  });

  it("returns null when iteminfo API returns non-200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 }))
    );
    const url = await resolveLivePhotoVideoUrl("123");
    expect(url).toBeNull();
  });
});
