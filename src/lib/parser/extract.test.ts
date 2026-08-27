import { describe, expect, it } from "vitest";
import { extractMusicMetaFromSource, findItemInApiJson } from "./extract";

describe("extractMusicMetaFromSource", () => {
  it("提取汽水音乐（版权音乐）的真实歌名与作者", () => {
    const src = {
      mid: "7574044582909184804",
      title: "@7iovo_Cc创作的原声一7iovo_Cc（原声中的歌曲：你的轮廓在黑夜之中淹没-朗鹅鎏汐）",
      author: "7iovo_Cc",
      cover_large: {
        url_list: ["https://p26.example.com/cover.jpeg"],
      },
    };
    const meta = extractMusicMetaFromSource(src);
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe("你的轮廓在黑夜之中淹没");
    expect(meta!.author).toBe("朗鹅鎏汐");
    expect(meta!.isOriginalSound).toBe(false);
    expect(meta!.cover).toBe("https://p26.example.com/cover.jpeg");
  });

  it("普通用户原声回退为 music.title / music.author", () => {
    const src = {
      title: "@小明创作的原声",
      author: "小明",
    };
    const meta = extractMusicMetaFromSource(src);
    expect(meta).not.toBeNull();
    expect(meta!.title).toBe("@小明创作的原声");
    expect(meta!.author).toBe("小明");
    expect(meta!.isOriginalSound).toBe(true);
  });

  it("优先取 cover_large，缺失时回退 cover_hd", () => {
    const src = {
      title: "歌",
      author: "作者",
      cover_hd: { url_list: ["https://p3.example.com/hd.jpeg"] },
      cover_medium: { url_list: ["https://p3.example.com/md.jpeg"] },
    };
    const meta = extractMusicMetaFromSource(src);
    expect(meta!.cover).toBe("https://p3.example.com/hd.jpeg");
  });

  it("无 title/author 时返回 null", () => {
    expect(extractMusicMetaFromSource(null)).toBeNull();
    expect(extractMusicMetaFromSource({})).toBeNull();
    expect(extractMusicMetaFromSource("not an object")).toBeNull();
  });
});

describe("findItemInApiJson", () => {
  it("从 aweme_detail 单对象提取 item", () => {
    const body = JSON.stringify({
      status_code: 0,
      aweme_detail: { aweme_id: "123", desc: "测试", author: {} },
    });
    const item = findItemInApiJson(body, "123");
    expect(item).not.toBeNull();
    expect(item!.aweme_id).toBe("123");
  });

  it("从 item_list 数组按 aweme_id 匹配", () => {
    const body = JSON.stringify({
      status_code: 0,
      item_list: [
        { aweme_id: "111", desc: "a" },
        { aweme_id: "222", desc: "b", author: {} },
      ],
    });
    const item = findItemInApiJson(body, "222");
    expect(item).not.toBeNull();
    expect(item!.aweme_id).toBe("222");
  });

  it("无 aweme_id 时回退取数组首项", () => {
    const body = JSON.stringify({
      item_list: [{ aweme_id: "999", desc: "x", author: {} }],
    });
    const item = findItemInApiJson(body);
    expect(item!.aweme_id).toBe("999");
  });

  it("data.item_list 嵌套结构也能识别", () => {
    const body = JSON.stringify({
      data: { item_list: [{ aweme_id: "555", desc: "y", author: {} }] },
    });
    expect(findItemInApiJson(body, "555")!.aweme_id).toBe("555");
  });

  it("非 JSON 或不含 aweme 数据时返回 null", () => {
    expect(findItemInApiJson("not json")).toBeNull();
    expect(findItemInApiJson(JSON.stringify({ status_code: 1 }))).toBeNull();
    expect(findItemInApiJson("")).toBeNull();
  });

  it("回归：相关推荐/列表接口 list[0] 非目标作品时返回 null（不误取他人作品）", () => {
    // 复现用户日志中的 400：浏览器兜底拦截到 /web/api/v2/image/related/
    // 返回的 list[0] 是另一个 note（aweme_id=7677050352025443466），
    // 而目标作品为 7650923424965191668。旧实现会 fallback 到 list[0] 返回错误作品。
    const body = JSON.stringify({
      status_code: 0,
      item_list: [
        {
          aweme_id: "7677050352025443466",
          desc: "定格时光照相馆的笔记",
          author: { nickname: "定格时光照相馆" },
        },
        {
          aweme_id: "7677050352025443467",
          desc: "另一个无关作品",
          author: { nickname: "路人甲" },
        },
      ],
    });
    const item = findItemInApiJson(body, "7650923424965191668");
    expect(item).toBeNull();
  });
});
