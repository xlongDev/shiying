import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveLivePhotoVideoUrl,
  scanLivePhotosInRouterData,
  extractRouterData,
  detectLivePhotoPresence,
} from "./live-photo-resolver";

// 桩掉 chrome-finder，避免测试环境（无系统 Chrome）走无头浏览器回退时
// spawnSync(which chrome) 卡住。SSR 路径的回归验证不依赖浏览器。
vi.mock("./chrome-finder", () => ({
  findChromeExecutable: vi.fn(async () => null),
}));

/** 构造一段包含 window._ROUTER_DATA 的分享页 HTML，结构对齐 iesdouyin SSR */
function buildSsrHtml(item: Record<string, unknown>): string {
  const payload = {
    loaderData: {
      "note_(id)/page": { videoInfoRes: { item_list: [item] } },
    },
  };
  return `<html><body><script>window._ROUTER_DATA = ${JSON.stringify(payload)};</script></body></html>`;
}

/** mock 全局 fetch：命中 /share/note/ 时返回 SSR HTML，其余 404 */
function mockSharePage(html: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/share/note/") || url.includes("/share/video/")) {
        return new Response(html, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("not found", { status: 404 });
    })
  );
}

describe("extractRouterData", () => {
  it("提取 window._ROUTER_DATA 的 JSON 字符串（括号深度匹配）", () => {
    const html = `<script>window._ROUTER_DATA = {"a":{"b":{}},"c":1};</script>`;
    expect(extractRouterData(html)).toBe('{"a":{"b":{}},"c":1}');
  });
  it("无标记时返回 null", () => {
    expect(extractRouterData("<html>no data</html>")).toBeNull();
  });
});

describe("scanLivePhotosInRouterData (纯函数)", () => {
  it("从 image_info.live_photo 提取单图实况", () => {
    const rd = JSON.stringify({
      loaderData: {
        "note_(id)/page": {
          videoInfoRes: {
            item_list: [
              {
                image_info: {
                  live_photo: {
                    image: { url_list: ["https://p1.douyinpic.com/lp.jpg"] },
                    video: { url_list: ["https://v3-dy-z.douyinvod.com/lp.mp4"] },
                  },
                },
              },
            ],
          },
        },
      },
    });
    const lives = scanLivePhotosInRouterData(rd);
    expect(lives).toHaveLength(1);
    expect(lives[0].index).toBe(0);
    expect(lives[0].imageUrl).toContain("douyinpic");
    expect(lives[0].videoUrl).toContain("douyinvod");
  });

  it("从 images[] 中按 livePhotoType===1 提取（含 bitRateList 短片）", () => {
    const rd = JSON.stringify({
      loaderData: {
        "note_(id)/page": {
          videoInfoRes: {
            item_list: [
              {
                images: [
                  { url_list: ["https://p1.douyinpic.com/a.jpg"] },
                  {
                    url_list: ["https://p1.douyinpic.com/b.jpg"],
                    livePhotoType: 1,
                    video: {
                      bitRateList: [{ playAddr: [{ src: "https://v26-dy.douyinvod.com/sl.mp4" }] }],
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    });
    const lives = scanLivePhotosInRouterData(rd);
    expect(lives).toHaveLength(1);
    expect(lives[0].index).toBe(1);
    expect(lives[0].videoUrl).toContain("douyinvod");
  });

  it("无实况时返回空数组", () => {
    const rd = JSON.stringify({
      loaderData: {
        "note_(id)/page": {
          videoInfoRes: {
            item_list: [{ images: [{ url_list: ["https://p1.douyinpic.com/n.jpg"] }] }],
          },
        },
      },
    });
    expect(scanLivePhotosInRouterData(rd)).toEqual([]);
  });

  it("单图兜底：全局扫描 douyinvod（仿 QingZai findDouyinvodUrl）", () => {
    const rd = JSON.stringify({
      loaderData: {
        "note_(id)/page": {
          videoInfoRes: {
            item_list: [
              {
                images: [{ url_list: ["https://p1.douyinpic.com/only.jpg"] }],
                // 实况短片 URL 藏在非结构化位置
                someDeep: { video: "https://v3-dy-z.douyinvod.com/buried.mp4" },
              },
            ],
          },
        },
      },
    });
    const lives = scanLivePhotosInRouterData(rd);
    expect(lives).toHaveLength(1);
    expect(lives[0].videoUrl).toContain("douyinvod");
  });

  it("无法解析 JSON 时返回空数组", () => {
    expect(scanLivePhotosInRouterData("not json")).toEqual([]);
  });
});

describe("resolveLivePhotoVideoUrl (SSR path)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("DISABLE_LIVE_PHOTO_RESOLVE", "");
  });

  it("从 SSR 分享页提取实况动态短片 URL", async () => {
    const html = buildSsrHtml({
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
    mockSharePage(html);

    const url = await resolveLivePhotoVideoUrl("123456");
    expect(url).toContain("douyinvod");
    expect(url).toBe("https://v3-dy-z.douyinvod.com/short/xyz.mp4");
  });

  it("SSR 无实况时返回 null（且不触发无头浏览器）", async () => {
    const html = buildSsrHtml({
      images: [{ url_list: ["https://p1.douyinpic.com/normal.jpg"] }],
    });
    mockSharePage(html);

    const url = await resolveLivePhotoVideoUrl("123");
    expect(url).toBeNull();
  });
});

describe("detectLivePhotoPresence (轻量 API 预检)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("LIVE_PHOTO_SERVICE_URL", "");
  });

  it("SSR 含 live_photo 标记时返回 live", async () => {
    const html = buildSsrHtml({
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
    mockSharePage(html);

    const presence = await detectLivePhotoPresence("123");
    expect(presence.status).toBe("live");
    if (presence.status === "live") {
      expect(presence.lives).toHaveLength(1);
      expect(presence.lives[0].videoUrl).toContain("douyinvod");
    }
  });

  it("SSR 返回完整 images 但无实况标记时返回 static", async () => {
    const html = buildSsrHtml({
      images: [
        { url_list: ["https://p1.douyinpic.com/static1.jpg"] },
        { url_list: ["https://p1.douyinpic.com/static2.jpg"] },
      ],
    });
    mockSharePage(html);

    const presence = await detectLivePhotoPresence("456");
    expect(presence.status).toBe("static");
  });

  it("SSR 被 WAF 时返回 uncertain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(`<html><script>var waf_jschallenge={};</script></html>`, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      })
    );

    const presence = await detectLivePhotoPresence("789");
    expect(presence.status).toBe("uncertain");
  });

  it("SSR 返回 404 时返回 uncertain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("not found", { status: 404 });
      })
    );

    const presence = await detectLivePhotoPresence("000");
    expect(presence.status).toBe("uncertain");
  });
});
