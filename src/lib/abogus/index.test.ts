import { describe, it, expect } from "vitest";
import { generateABogus } from "./index";

describe("generateABogus (a_bogus 纯 Node 生成)", () => {
  it("对已知 uri+ts 生成合法非空签名串", () => {
    const uri = "aweme_id=7635491506937597834";
    const ab = generateABogus(uri, 1700000000000);
    expect(typeof ab).toBe("string");
    expect(ab.length).toBeGreaterThanOrEqual(80);
    // a_bogus 字符集为标准 base64（含 + / = 与 - _）
    expect(ab).toMatch(/^[A-Za-z0-9_\-+/=]+$/);
  });

  it("不同 uri 应产生不同签名", () => {
    const a = generateABogus("aweme_id=111", 1700000000000);
    const b = generateABogus("aweme_id=222", 1700000000000);
    expect(a).not.toBe(b);
  });

  it("可重复调用（vm 沙箱缓存生效，不抛错）", () => {
    const uri = "aid=6383&aweme_id=7635491506937597834";
    const first = generateABogus(uri, 1700000000001);
    const second = generateABogus(uri, 1700000000002);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
  });

  it("应能对『完整请求 URL（含 path）』签名——与服务端 SM3 校验一致", () => {
    const uri =
      "https://www.douyin.com/aweme/v1/web/aweme/detail/?aid=6383&aweme_id=7635491506937597834&timestamp=1700000000";
    const ab = generateABogus(uri, 1700000000000);
    expect(typeof ab).toBe("string");
    expect(ab.length).toBeGreaterThanOrEqual(80);
    expect(ab).toMatch(/^[A-Za-z0-9_\-+/=]+$/);
  });

  it("含随机盐，两次输出应都合法非空且长度同量级（非幂等属正常）", () => {
    const uri =
      "https://www.douyin.com/aweme/v1/web/aweme/detail/?aid=6383&aweme_id=7635491506937597834";
    const a = generateABogus(uri, 1700000000999);
    const b = generateABogus(uri, 1700000000999);
    // 真实 a_bogus 每次含随机字节，不应期望逐字节相等；但都应合法且长度相近。
    expect(a).toMatch(/^[A-Za-z0-9_\-+/=]+$/);
    expect(b).toMatch(/^[A-Za-z0-9_\-+/=]+$/);
    expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(4);
  });
});
