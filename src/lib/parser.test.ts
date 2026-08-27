import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractUrl,
  normalizeUrl,
  pickFirstUrl,
  formatNumber,
  pickBestImageUrl,
  extractDouyinId,
  detectPlatform,
  parseVideo,
  ParseError,
} from "./parser";

// 桩掉浏览器兜底，避免测试环境（无系统 Chrome）走无头浏览器回退时
// spawnSync(which chrome) 卡住。SSR 路径的回归验证不依赖浏览器。
vi.mock("./browser-router-data", () => ({
  loadRouterDataViaBrowser: vi.fn(async () => null),
  // 测试中无启动期预热带，isPrewarmPending 恒为 false，awaitPrewarm 为空操作，
  // 避免 a_bogus 首轮失败后等待一个不存在的预热带。
  isPrewarmPending: vi.fn(() => false),
  awaitPrewarm: vi.fn(async () => {}),
}));

/* ------------------------------------------------------------------ */
/* Pure helper functions                                              */
/* ------------------------------------------------------------------ */

describe("extractUrl", () => {
  it("returns a bare http(s) url trimmed", () => {
    expect(extractUrl("  https://a.com  ")).toBe("https://a.com");
  });
  it("extracts the first url from surrounding text", () => {
    expect(extractUrl("see https://b.com now")).toBe("https://b.com");
  });
  it("returns null when there is no url", () => {
    expect(extractUrl("no link here")).toBeNull();
    expect(extractUrl("")).toBeNull();
    expect(extractUrl("   ")).toBeNull();
  });
});

describe("normalizeUrl", () => {
  it("passes through http/https", () => {
    expect(normalizeUrl("http://x.com")).toBe("http://x.com");
    expect(normalizeUrl("https://x.com")).toBe("https://x.com");
  });
  it("prefixes protocol-relative urls with https", () => {
    expect(normalizeUrl("//x.com/a")).toBe("https://x.com/a");
  });
  it("returns empty for non-url strings", () => {
    expect(normalizeUrl("x.com")).toBe("");
    expect(normalizeUrl("")).toBe("");
  });
});

describe("pickFirstUrl", () => {
  it("normalizes the first protocol-relative string", () => {
    expect(pickFirstUrl(["//a", "https://b"])).toBe("https://a");
  });
  it("unwraps nested url_list objects", () => {
    expect(pickFirstUrl([{ url_list: ["https://c"] }])).toBe("https://c");
  });
  it("falls back to url / uri fields", () => {
    expect(pickFirstUrl([{ url: "//d" }])).toBe("https://d");
    expect(pickFirstUrl([{ uri: "//e" }])).toBe("https://e");
  });
  it("returns empty when nothing resolvable", () => {
    expect(pickFirstUrl(["garbage"])).toBe("");
    expect(pickFirstUrl([])).toBe("");
    expect(pickFirstUrl(null)).toBe("");
  });
});

describe("formatNumber", () => {
  it("passes through numbers", () => {
    expect(formatNumber(5)).toBe(5);
  });
  it("parses numeric strings", () => {
    expect(formatNumber("42")).toBe(42);
  });
  it("returns undefined for non-numeric input", () => {
    expect(formatNumber("abc")).toBeUndefined();
    expect(formatNumber(null)).toBeUndefined();
    expect(formatNumber({})).toBeUndefined();
  });
});

describe("pickBestImageUrl", () => {
  it("prefers tplv-dy-aweme-images over other cdn urls", () => {
    const img = {
      url_list: ["https://x/water-v2/y", "https://z/tplv-dy-aweme-images/w"],
    };
    expect(pickBestImageUrl(img)).toBe("https://z/tplv-dy-aweme-images/w");
  });
  it("falls back to the first url when no preferred cdn", () => {
    expect(pickBestImageUrl({ url_list: ["https://x/plain"] })).toBe("https://x/plain");
  });
  it("excludes water-v2 from download_url_list", () => {
    const img = {
      url_list: [],
      download_url_list: ["https://q/water-v2/r", "https://s/clean/t"],
    };
    expect(pickBestImageUrl(img)).toBe("https://s/clean/t");
  });
  it("returns empty for empty input", () => {
    expect(pickBestImageUrl({})).toBe("");
  });
});

describe("extractDouyinId", () => {
  it("detects slides / video / note share paths", () => {
    expect(extractDouyinId("https://www.douyin.com/share/slides/999/")).toEqual({
      id: "999",
      type: "slides",
    });
    expect(extractDouyinId("https://www.douyin.com/share/video/111/")).toEqual({
      id: "111",
      type: "video",
    });
    expect(extractDouyinId("https://www.douyin.com/share/note/222/")).toEqual({
      id: "222",
      type: "note",
    });
  });
  it("detects deep-link query params as video", () => {
    expect(extractDouyinId("https://www.douyin.com/?modal_id=333")).toEqual({
      id: "333",
      type: "video",
    });
    expect(extractDouyinId("https://www.douyin.com/?aweme_id=444")).toEqual({
      id: "444",
      type: "video",
    });
    expect(extractDouyinId("https://www.douyin.com/?item_ids=555")).toEqual({
      id: "555",
      type: "video",
    });
  });
  it("returns null for non-douyin-id urls", () => {
    expect(extractDouyinId("https://www.douyin.com/explore")).toBeNull();
  });
});

describe("detectPlatform", () => {
  it("matches douyin / iesdouyin / v.douyin hosts", () => {
    expect(detectPlatform("https://www.douyin.com/x")).toBe("douyin");
    expect(detectPlatform("https://www.iesdouyin.com/x")).toBe("douyin");
    expect(detectPlatform("https://v.douyin.com/x")).toBe("douyin");
  });
  it("returns null for other platforms", () => {
    expect(detectPlatform("https://youtube.com/x")).toBeNull();
    expect(detectPlatform("https://example.com")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* parseVideo (network functions, mocked fetch)                      */
/* ------------------------------------------------------------------ */

function buildRouterHtml(data: unknown): string {
  return `<html><body><script>_ROUTER_DATA = ${JSON.stringify(data)}</script></body></html>`;
}

const videoData = {
  loaderData: {
    "video_(123)/page": {
      videoInfoRes: {
        item_list: [
          {
            desc: "hello",
            author: {
              nickname: "bob",
              avatar_thumb: { url_list: ["https://avatar/img"] },
            },
            statistics: { digg_count: "100", comment_count: "5", share_count: "2" },
            video: {
              play_addr: { url_list: ["https://v.example/playwm/abc123"] },
              cover: { url_list: ["https://cover/img"] },
              duration: 5000,
            },
            music: { play_url: { url_list: ["https://m.example/a.mp3"] } },
          },
        ],
      },
    },
  },
};

const noteData = {
  loaderData: {
    "note_(123)/page": {
      videoInfoRes: {
        item_list: [
          {
            desc: "album",
            author: {
              nickname: "amy",
              avatar_medium: { url_list: ["https://avatar2"] },
            },
            statistics: { digg_count: "10" },
            images: [{ url_list: ["https://img/normal", "https://img/tplv-dy-aweme-images-x"] }],
            music: { play_url: { url_list: ["https://m.example/b.mp3"] } },
          },
        ],
      },
    },
  },
};

describe("parseVideo", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws EMPTY_URL when no url is supplied", async () => {
    await expect(parseVideo("   ")).rejects.toMatchObject({
      code: "EMPTY_URL",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws UNSUPPORTED_PLATFORM for non-douyin links", async () => {
    await expect(parseVideo("https://youtube.com/watch?v=1")).rejects.toMatchObject({
      code: "UNSUPPORTED_PLATFORM",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws NO_AWEME_ID when the id cannot be extracted", async () => {
    await expect(parseVideo("https://www.douyin.com/explore")).rejects.toMatchObject({
      code: "NO_AWEME_ID",
    });
  });

  it("throws SHORT_LINK_FAILED when short-link resolution errors", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(parseVideo("https://v.douyin.com/abc")).rejects.toMatchObject({
      code: "SHORT_LINK_FAILED",
    });
  });

  it("throws NO_ROUTER_DATA when the share page has no router payload", async () => {
    fetchMock.mockImplementation(
      () => new Response("<html><body>no data</body></html>", { status: 200 })
    );
    await expect(
      parseVideo("https://www.iesdouyin.com/share/video/123/", { skipLivePhoto: true })
    ).rejects.toMatchObject({ code: "NO_ROUTER_DATA" });
  });

  it("throws SLIDES_NO_DATA when slides SSR yields no images", async () => {
    fetchMock.mockImplementation(
      () => new Response("<html><body>no data</body></html>", { status: 200 })
    );
    await expect(
      parseVideo("https://www.douyin.com/share/slides/777/", { skipLivePhoto: true })
    ).rejects.toMatchObject({ code: "SLIDES_NO_DATA" });
  });

  it("parses a normal video and strips the watermark url", async () => {
    fetchMock.mockImplementation(() => new Response(buildRouterHtml(videoData), { status: 200 }));
    const r = await parseVideo("https://www.iesdouyin.com/share/video/123/", {
      skipLivePhoto: true,
    });
    expect(r.awemeId).toBe("123");
    expect(r.contentType).toBe("video");
    expect(r.videoUrl).toBe("https://v.example/play/abc123");
    expect(r.author.name).toBe("bob");
    expect(r.stats?.likeCount).toBe(100);
    expect(r.duration).toBe(5);
    expect(r.hasMusic).toBe(true);
    expect(r.isImagePost).toBeFalsy();
  });

  it("parses a note (image post) and prefers tplv aweme images", async () => {
    fetchMock.mockImplementation(() => new Response(buildRouterHtml(noteData), { status: 200 }));
    const r = await parseVideo("https://www.iesdouyin.com/share/note/123/", {
      skipLivePhoto: true,
    });
    expect(r.contentType).toBe("note");
    expect(r.isImagePost).toBe(true);
    expect(r.images).toEqual(["https://img/tplv-dy-aweme-images-x"]);
    expect(r.videoUrl).toBe("");
    expect(r.hasMusic).toBe(true);
  });

  it("passes through ParseError subclasses", async () => {
    const err = new ParseError("x", "CUSTOM");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("CUSTOM");
  });
});
