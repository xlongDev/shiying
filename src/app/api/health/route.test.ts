import { describe, it, expect } from "vitest";
import { GET } from "./route";

/**
 * GET /api/health 集成测试。
 *
 * 该路由仅做能力探测（findChromeExecutable 为纯 fs 探测 + config 读取），
 * 不发起任何网络请求，因此可在 CI 无头环境下稳定断言其接线与返回形状。
 */
describe("GET /api/health", () => {
  it("返回 200 并携带解析后端能力字段", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.chrome).toBe("boolean");
    expect(typeof body.livePhotoService).toBe("boolean");
    expect(typeof body.appleLivePhoto).toBe("boolean");
    expect(typeof body.degraded).toBe("boolean");
    expect(typeof body.message).toBe("string");
  });

  it("degraded 与 chrome/livePhotoService 逻辑一致", async () => {
    const body = await (await GET()).json();
    // degraded 定义为「无 Chrome 且无国内服务」——与两个开关的布尔关系一致
    expect(body.degraded).toBe(!body.chrome && !body.livePhotoService);
  });
});
