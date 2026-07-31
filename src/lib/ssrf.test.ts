import { describe, it, expect, vi, beforeEach } from "vitest";
import { isPrivateIp, isAllowedTarget } from "./ssrf";

// 用 vi.hoisted 在模块 mock 工厂之外创建可被测试引用的 mock 实例。
// 变量声明（string 类型）可避免 TS 对字面量模块做路径解析，使可选依赖缺失时仍可编译。
const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("node:dns", () => ({
  promises: { lookup: lookupMock },
}));

describe("isPrivateIp", () => {
  it("识别私网 / 保留 IPv4", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("172.16.5.4")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
    expect(isPrivateIp("192.168.0.1")).toBe(true);
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true); // 云 metadata 地址
    expect(isPrivateIp("0.0.0.0")).toBe(true);
    expect(isPrivateIp("100.64.0.1")).toBe(true); // CGNAT
  });

  it("放行公网 IPv4", () => {
    expect(isPrivateIp("1.1.1.1")).toBe(false);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("203.0.113.5")).toBe(false);
  });

  it("非法 IPv4 一律按私有拒绝", () => {
    expect(isPrivateIp("256.1.1.1")).toBe(true);
    expect(isPrivateIp("abc")).toBe(true);
    expect(isPrivateIp("1.2.3")).toBe(true);
  });

  it("识别私网 / 保留 IPv6", () => {
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("::")).toBe(true);
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("fd12:3456::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true); // IPv4 映射地址
    expect(isPrivateIp("::ffff:10.0.0.1")).toBe(true);
  });

  it("放行公网 IPv6", () => {
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateIp("2001:db8::1")).toBe(false);
  });

  it("去除作用域标识与方括号", () => {
    expect(isPrivateIp("fe80::1%eth0")).toBe(true);
    expect(isPrivateIp("[::1]")).toBe(true);
  });
});

describe("isAllowedTarget", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it("拒绝非法 URL", async () => {
    expect(await isAllowedTarget("not a url")).toBe(false);
    expect(await isAllowedTarget("")).toBe(false);
  });

  it("拒绝非 http/https 协议", async () => {
    expect(await isAllowedTarget("ftp://example.com/x")).toBe(false);
    expect(await isAllowedTarget("file:///etc/passwd")).toBe(false);
    expect(await isAllowedTarget("gopher://169.254.169.254/")).toBe(false);
  });

  it("拒绝白名单之外的主机（含云 metadata IP）", async () => {
    expect(await isAllowedTarget("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(await isAllowedTarget("http://evil.com/x")).toBe(false);
    expect(await isAllowedTarget("https://example.org/foo")).toBe(false);
  });

  it("白名单后缀命中但解析为内网 IP 时拒绝", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    expect(await isAllowedTarget("https://evil.douyin.com/video")).toBe(false);
    expect(lookupMock).toHaveBeenCalled();
  });

  it("白名单主机解析为公网 IP 时放行", async () => {
    lookupMock.mockResolvedValue([{ address: "180.101.49.12", family: 4 }]);
    expect(await isAllowedTarget("https://www.douyin.com/x")).toBe(true);
    expect(await isAllowedTarget("https://v26.douyinvod.com/x.mp4")).toBe(true);
    expect(await isAllowedTarget("https://aweme.snssdk.com/play/?a=1")).toBe(true);
  });

  it("任一解析 IP 为私网即拒绝", async () => {
    lookupMock.mockResolvedValue([
      { address: "180.101.49.12", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    expect(await isAllowedTarget("https://www.douyin.com/x")).toBe(false);
  });

  it("DNS 解析失败时拒绝", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    expect(await isAllowedTarget("https://www.douyin.com/x")).toBe(false);
  });
});
