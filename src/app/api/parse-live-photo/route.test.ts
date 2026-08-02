import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

function makeReq(ip: string, body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/parse-live-photo", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/parse-live-photo", () => {
  it("缺少 awemeId 时返回 400（输入校验）", async () => {
    const res = await POST(makeReq("lpr-it-empty-1", { mode: "single" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("single 模式缺少 imageUrl 时返回 400", async () => {
    const res = await POST(makeReq("lpr-it-img-1", { mode: "single", awemeId: "730000000000" }));
    expect(res.status).toBe(400);
  });

  it("slides 模式缺少 imageUrls 时返回 400", async () => {
    const res = await POST(makeReq("lpr-it-slides-1", { mode: "slides", awemeId: "730000000000" }));
    expect(res.status).toBe(400);
  });

  it("同 IP 超过 6 次/分钟触发 429 限流", async () => {
    const ip = `lpr-rl-${Math.random().toString(36).slice(2)}`;
    const statuses: number[] = [];
    // 实况探测限流更紧（6/分钟）。限流闸在输入校验前，前 6 次放行（随后校验失败），
    // 第 7 次被限流返回 429。不触达 resolveLivePhotoVideoUrl，无需无头浏览器。
    for (let i = 0; i < 7; i++) {
      statuses.push((await POST(makeReq(ip, { mode: "single" }))).status);
    }
    expect(statuses[0]).toBe(400); // 首次放行（随后缺 awemeId）
    expect(statuses[6]).toBe(429); // 第 7 次被限流
  });
});
