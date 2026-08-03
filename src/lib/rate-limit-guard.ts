import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "./rate-limit";
import { getClientIp } from "./client-ip";

/**
 * 统一限流护栏：按客户端 IP 对指定端点限速。
 *
 * 在路由处理函数最前调用，命中限流时返回 429 NextResponse，
 * 否则返回 null，调用方继续处理。存储后端（内存 / Upstash）由 rateLimit 内部决定。
 *
 * @param req      请求
 * @param name     端点名（限流 key 维度，如 "proxy" / "extract-audio"）
 * @param limit    窗口内最大请求数
 * @param windowMs 窗口时长（毫秒）
 * @param message  触顶时返回的错误文案（默认通用）
 */
export async function guardRateLimit(
  req: NextRequest,
  name: string,
  limit: number,
  windowMs: number,
  message = "请求过于频繁，请稍后再试"
): Promise<NextResponse | null> {
  const rl = await rateLimit(`${name}:${getClientIp(req)}`, limit, windowMs);
  if (rl.allowed) return null;
  return NextResponse.json(
    { ok: false, error: message, code: "RATE_LIMITED" },
    {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) },
    }
  );
}
