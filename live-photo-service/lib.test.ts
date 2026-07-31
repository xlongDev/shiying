import { describe, it, expect } from "vitest";
import { parseAwemeDetailLivePhotos, generateABogus, generateSyntheticTtwid } from "./lib.js";

// a_bogus 生成器在 Node 端可用（验证服务与前端同源算法一致）
describe("a_bogus 生成器", () => {
  it("生成非空且字符集合法的签名串", () => {
    const ab = generateABogus("aweme_id=12345", 1700000000000);
    expect(typeof ab).toBe("string");
    expect(ab.length).toBeGreaterThanOrEqual(80);
    // a_bogus 为标准 base64（含 + / =）
    expect(ab).toMatch(/^[A-Za-z0-9+/=_-]+$/);
  });

  it("a_bogus 含随机成分（非确定性，符合抖音防重放设计），两次均生成合法格式", () => {
    const a = generateABogus("aweme_id=999", 1234567890);
    const b = generateABogus("aweme_id=999", 1234567890);
    // 两次结果通常不同（内置 Math.random），但都应是合法 a_bogus（标准/base64 url-safe 变体）
    expect(a).toMatch(/^[A-Za-z0-9+/=_-]+$/);
    expect(b).toMatch(/^[A-Za-z0-9+/=_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(80);
  });

  it("generateSyntheticTtwid 产出 ttwid=1| 前缀", () => {
    const t = generateSyntheticTtwid();
    expect(t.startsWith("ttwid=1|")).toBe(true);
    expect(t.length).toBeGreaterThan(8);
  });
});

// 解析逻辑：覆盖单图 / 混合图文（slides）/ 无实况 三种形态
describe("parseAwemeDetailLivePhotos", () => {
  it("单图实况：从 image_info.live_photo 提取", () => {
    const json = {
      aweme_detail: {
        image_info: {
          live_photo: {
            image: { url_list: ["https://p1.douyinpic.com/s.jpeg"] },
            video: {
              bitRateList: [{ playAddr: [{ src: "https://v1.douyinvod.com/s.mp4" }] }],
            },
          },
        },
      },
    };
    const out = parseAwemeDetailLivePhotos(json);
    expect(out).toHaveLength(1);
    expect(out[0].index).toBe(0);
    expect(out[0].imageUrl).toContain("douyinpic");
    expect(out[0].videoUrl).toContain("douyinvod");
  });

  it("混合图文（slides）：从 image_post_info.images 提取实况", () => {
    const json = {
      aweme_detail: {
        image_post_info: {
          images: [
            { url_list: ["https://p1.douyinpic.com/1.jpeg"], video: null },
            {
              url_list: ["https://p1.douyinpic.com/2.jpeg"],
              clipType: 5,
              video: {
                bitRateList: [{ playAddr: [{ src: "https://v1.douyinvod.com/2.mp4" }] }],
              },
            },
            { url_list: ["https://p1.douyinpic.com/3.jpeg"], video: null },
          ],
        },
      },
    };
    const out = parseAwemeDetailLivePhotos(json);
    expect(out).toHaveLength(1);
    expect(out[0].index).toBe(1); // 索引对应原数组位置
    expect(out[0].videoUrl).toContain("douyinvod");
  });

  it("无实况帖返回空数组", () => {
    const json = {
      aweme_detail: {
        images: [
          { url_list: ["https://p1.douyinpic.com/1.jpeg"] },
          { url_list: ["https://p1.douyinpic.com/2.jpeg"] },
        ],
      },
    };
    expect(parseAwemeDetailLivePhotos(json)).toEqual([]);
  });

  it("缺少 aweme_detail 返回空数组", () => {
    expect(parseAwemeDetailLivePhotos({ status_code: 0 })).toEqual([]);
    expect(parseAwemeDetailLivePhotos(null)).toEqual([]);
  });

  it("video 通过 play_addr.url_list 提取", () => {
    const json = {
      aweme_detail: {
        images: [
          {
            url_list: ["https://p1.douyinpic.com/x.jpeg"],
            live_photo: true,
            video: {
              play_addr: { url_list: ["https://v1.douyinvod.com/x.mp4"] },
            },
          },
        ],
      },
    };
    const out = parseAwemeDetailLivePhotos(json);
    expect(out).toHaveLength(1);
    expect(out[0].videoUrl).toContain("douyinvod");
  });
});
