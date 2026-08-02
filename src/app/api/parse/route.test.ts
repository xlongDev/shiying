import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function makeReq(ip: string, body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/parse", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/parse", () => {
  it("缺少 url 时返回 400 EMPTY_URL（输入校验）", async () => {
    const res = await POST(makeReq("parse-it-empty-1", {}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("EMPTY_URL");
  });

  it("url 为非字符串时同样返回 400 EMPTY_URL", async () => {
    const res = await POST(makeReq("parse-it-empty-2", { url: 12345 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("EMPTY_URL");
  });

  it("同 IP 超过 20 次/分钟触发 429 限流", async () => {
    const ip = `parse-rl-${Math.random().toString(36).slice(2)}`;
    const statuses: number[] = [];
    // 限流闸在输入校验之前，因此即便 url 为空，前 20 次仍被计数并返回 400（放行），
    // 第 21 次被限流返回 429。该路径不触达 parseVideo，无需真实 Chrome/网络。
    for (let i = 0; i < 21; i++) {
      statuses.push((await POST(makeReq(ip, { url: "" }))).status);
    }
    expect(statuses[0]).toBe(400); // 首次放行（随后校验失败）
    expect(statuses[20]).toBe(429); // 第 21 次被限流
  });
});
