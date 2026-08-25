import { describe, it, expect } from "vitest";
import {
  buildConcatList,
  buildEncodeCommand,
  curveProgress,
  type SegmentInfo,
} from "@/lib/ffmpeg-compose/compose-helpers";

const segments: SegmentInfo[] = [
  { file: "frame_000.jpg", duration: 0, isVideo: false },
  { file: "live_001.mp4", duration: 2.5, isVideo: true },
];

describe("buildConcatList", () => {
  it("输出 ffconcat 头 + 每段 file/duration + 末尾重复末帧", () => {
    const out = buildConcatList(segments, 3);
    const lines = out.split("\n");
    expect(lines[0]).toBe("ffconcat version 1.0");
    expect(lines).toContain("file 'frame_000.jpg'");
    // 静态图无时长 → 用 effectivePerImage(3) → fmtDuration 输出 3.000
    expect(lines).toContain("duration 3.000");
    expect(lines).toContain("file 'live_001.mp4'");
    // 实况视频用真实时长 2.5 → fmtDuration 输出 2.500
    expect(lines).toContain("duration 2.500");
    // 末尾重复最后一帧
    expect(lines[lines.length - 1]).toBe("file 'live_001.mp4'");
  });
});

describe("buildEncodeCommand", () => {
  it("无音乐：以 -an 静音，不注入 stream_loop", () => {
    const cmd = buildEncodeCommand(false);
    expect(cmd).toContain("-an");
    expect(cmd).not.toContain("-stream_loop");
    expect(cmd[cmd.length - 1]).toBe("output.mp4");
  });

  it("有音乐：注入音频循环与 -shortest", () => {
    const cmd = buildEncodeCommand(true);
    expect(cmd).toEqual(
      expect.arrayContaining([
        "-stream_loop",
        "-1",
        "-i",
        "music.bin",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-shortest",
      ])
    );
  });
});

describe("curveProgress", () => {
  it("端点映射 0→0, 1→1", () => {
    expect(curveProgress(0)).toBeCloseTo(0, 5);
    expect(curveProgress(1)).toBeCloseTo(1, 5);
  });

  it("越界输入限幅到 [0,1]", () => {
    expect(curveProgress(-5)).toBe(0);
    expect(curveProgress(5)).toBe(1);
  });

  it("整体单调递增", () => {
    let prev = -1;
    for (let r = 0; r <= 1; r += 0.05) {
      const v = curveProgress(r);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});
