import { describe, expect, it } from "vitest";
import { extractMusicMetaFromSource } from "./extract";

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
