import { describe, it, expect } from "vitest";
import { formatTime } from "./format-time";

describe("formatTime", () => {
  it("formats whole minutes and seconds", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(125)).toBe("2:05");
    expect(formatTime(599)).toBe("9:59");
    expect(formatTime(3600)).toBe("60:00");
  });

  it("falls back to 0:00 for non-finite / negative values", () => {
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
    expect(formatTime(-1)).toBe("0:00");
    expect(formatTime(-0.5)).toBe("0:00");
  });

  it("pads single-digit seconds", () => {
    expect(formatTime(9.9)).toBe("0:09");
    expect(formatTime(0.4)).toBe("0:00");
  });
});
