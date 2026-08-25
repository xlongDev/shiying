import { describe, it, expect, vi, afterEach } from "vitest";
// 必须用命名空间导入：默认导入 (import cp from) 拿到的是真实模块的 default，
// 会绕过下面 vi.mock 工厂替换的具名 execFileSync。
import * as cp from "node:child_process";
import {
  resolveFfmpegBin,
  isJpeg,
  writeJpegContentIdentifier,
  buildAppleMakerNote,
  writeMovContentIdentifier,
  buildMetaBox,
  parseBoxes,
} from "./apple-live-photo";

// 用 vi.mock 替换 node:child_process 的 execFileSync，使模块内部的具名导入也指向 mock。
// （具名导入是编译期绑定，vi.spyOn 无法拦截，必须用 vi.mock 整体替换模块。）
// resolveFfmpegBin 改用「执行 ffmpeg -version 探测」取代 existsSync，故此处 mock execFileSync。
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

const mockExec = cp.execFileSync as ReturnType<typeof vi.fn>;

/** 最小合法 JPEG：SOI(ffd8) + EOI(ffd9)。 */
function minimalJpeg(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
}

/** 合成一个极简 MP4，含 ftyp + moov(mvhd + stco)，用于验证 chunk offset 平移。 */
function minimalMp4(stcoOffset: number): Buffer {
  const mvhd = Buffer.alloc(12);
  mvhd.writeUInt32BE(12, 0);
  mvhd.write("mvhd", 4, "latin1");

  const stco = Buffer.alloc(20);
  stco.writeUInt32BE(20, 0);
  stco.write("stco", 4, "latin1");
  stco.writeUInt32BE(0, 8); // version + flags
  stco.writeUInt32BE(1, 12); // entryCount
  stco.writeUInt32BE(stcoOffset, 16); // 单个 chunk 的绝对文件偏移

  const moovBody = Buffer.concat([mvhd, stco]);
  const moov = Buffer.alloc(8 + moovBody.length);
  moov.writeUInt32BE(moov.length, 0);
  moov.write("moov", 4, "latin1");
  moovBody.copy(moov, 8);

  const ftyp = Buffer.alloc(16);
  ftyp.writeUInt32BE(16, 0);
  ftyp.write("ftyp", 4, "latin1");

  return Buffer.concat([ftyp, moov]);
}

describe("resolveFfmpegBin", () => {
  const ORIG = process.env.FFMPEG_PATH;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = ORIG;
    mockExec.mockReset();
  });

  it("优先使用 FFMPEG_PATH 环境变量", () => {
    process.env.FFMPEG_PATH = "/custom/path/ffmpeg";
    expect(resolveFfmpegBin()).toBe("/custom/path/ffmpeg");
  });

  it("FFMPEG_PATH 未设且候选路径都不可用（探测失败）时回退到 ffmpeg（交给 PATH）", () => {
    delete process.env.FFMPEG_PATH;
    mockExec.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(resolveFfmpegBin()).toBe("ffmpeg");
  });

  it("探测到候选路径可用时返回该绝对路径（覆盖 dev server 不继承 PATH 的场景）", () => {
    delete process.env.FFMPEG_PATH;
    mockExec.mockImplementation((cmd: unknown) => {
      if (String(cmd).includes("homebrew")) return Buffer.from("");
      throw new Error("ENOENT");
    });
    expect(resolveFfmpegBin()).toBe("/opt/homebrew/bin/ffmpeg");
  });
});

describe("JPEG content identifier 写入", () => {
  const UUID = "8F14E45F-CEEA-167A-5A8B-3A2C4D5E6F70";

  it("isJpeg 正确识别 JPEG 魔数", () => {
    expect(isJpeg(minimalJpeg())).toBe(true);
    expect(isJpeg(Buffer.from("not a jpeg"))).toBe(false);
  });

  it("buildAppleMakerNote 以 'Apple iOS\\0' 开头且长度随 UUID 增长", () => {
    const mn = buildAppleMakerNote(UUID);
    expect(mn.subarray(0, 10).toString("latin1")).toBe("Apple iOS\0");
    // header(14) + IFD(18) + value(UUID.length + 1)
    expect(mn.length).toBe(14 + 18 + (UUID.length + 1));
  });

  it("writeJpegContentIdentifier 在 SOI 后插入 APP1 并嵌入 UUID", () => {
    const out = writeJpegContentIdentifier(minimalJpeg(), UUID);
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(out[2]).toBe(0xff);
    expect(out[3]).toBe(0xe1); // 新插入的 APP1
    expect(out.subarray(out.length - 2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
    expect(out.toString("latin1")).toContain(UUID);
  });

  it("重复写入只保留一个 APP1（UUID 仅出现一次）", () => {
    const once = writeJpegContentIdentifier(minimalJpeg(), UUID);
    const twice = writeJpegContentIdentifier(once, UUID);
    const matches = twice.toString("latin1").split(UUID).length - 1;
    expect(matches).toBe(1);
  });

  it("非 JPEG 输入抛错", () => {
    expect(() => writeJpegContentIdentifier(Buffer.from("data"), UUID)).toThrow();
  });
});

describe("MOV content identifier 写入", () => {
  const UUID = "8F14E45F-CEEA-167A-5A8B-3A2C4D5E6F70";
  const KEY = "com.apple.quicktime.content.identifier";

  it("buildMetaBox 默认不带 version/flags（QuickTime 风格）", () => {
    const meta = buildMetaBox(UUID);
    expect(meta.subarray(4, 8).toString("latin1")).toBe("meta");
    // 紧随 meta 的第一个子盒是 hdlr：offset 8..12 是 hdlr 自身 size(33=0x21)，12..16 才是 'hdlr'
    expect(meta.readUInt32BE(8)).toBe(33);
    expect(meta.subarray(12, 16).toString("latin1")).toBe("hdlr");
    expect(meta.toString("latin1")).toContain(KEY);
    expect(meta.toString("latin1")).toContain(UUID);
  });

  it("buildMetaBox(fullBox=true) 在 meta 后写 4 字节版本/flags", () => {
    const meta = buildMetaBox(UUID, true);
    expect(meta.readUInt32BE(8)).toBe(0); // version + flags
    expect(meta.readUInt32BE(12)).toBe(33); // hdlr 自身 size
    expect(meta.subarray(16, 20).toString("latin1")).toBe("hdlr");
  });

  it("writeMovContentIdentifier 注入 meta 且平移 stco chunk offset", () => {
    const mp4 = minimalMp4(1000);
    const metaLen = buildMetaBox(UUID).length;
    const out = writeMovContentIdentifier(mp4, UUID);

    // 1) 关键 key 已写入 moov
    expect(out.toString("latin1")).toContain(KEY);

    // 2) moov 自身的 size 增加了 meta 盒子的长度
    const top = parseBoxes(out, 0, out.length);
    const moov = top.find((b) => b.type === "moov")!;
    expect(moov.end - moov.start).toBe(40 + metaLen);

    // 3) stco 里 >= 拼接点的 offset 被平移了 metaLen
    const stco = parseBoxes(out, moov.bodyStart, moov.end).find((b) => b.type === "stco")!;
    const entryCount = out.readUInt32BE(stco.bodyStart + 4);
    expect(entryCount).toBe(1);
    const shifted = out.readUInt32BE(stco.bodyStart + 8);
    expect(shifted).toBe(1000 + metaLen);
  });

  it("缺少 moov 盒子时抛错", () => {
    const noMoov = Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from("free")]);
    expect(() => writeMovContentIdentifier(noMoov, UUID)).toThrow();
  });
});
