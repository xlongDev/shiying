import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

function makeReq(url: string | null, ip: string): NextRequest {
  const base = "http://localhost/api/proxy-media";
  const full = url === null ? base : `${base}?url=${encodeURIComponent(url)}`;
  return new NextRequest(full, { headers: { "x-forwarded-for": ip } });
}

describe("GET /api/proxy-media (SSRF 防护)", () => {
  it("缺少 url 参数时返回 400（输入校验优先于代理）", async () => {
    const res = await GET(makeReq(null, `proxy-media-miss-${Math.random()}`));
    expect(res.status).toBe(400);
  });

  it("内网 / 元数据 / localhost 地址一律被拒绝 (403)", async () => {
    const targets = [
      "http://127.0.0.1:8080/secret",
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost/internal",
    ];
    for (const target of targets) {
      const res = await GET(makeReq(target, `proxy-media-ssrf-${Math.random()}`));
      expect(res.status).toBe(403);
    }
  });
});
