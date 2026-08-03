import type { NextRequest } from "next/server";

/**
 * 提取真实客户端 IP（用于限流维度）。
 *
 * 优先级：
 *   1. CF-Connecting-IP —— Cloudflare 边缘在请求进入时注入，客户端无法伪造；
 *      本项目经 Cloudflare Tunnel 暴露，真实客户端 IP 即在此头。
 *   2. x-forwarded-for 最右端 —— 由受信反向代理追加在末尾；取最后一个而非第一个，
 *      因为客户端可在最左随意伪造 X-Forwarded-For，但无法篡改代理追加在右侧的值。
 *   3. x-real-ip —— 部分反向代理（如 Nginx）使用。
 *   4. 兜底 "unknown"。
 *
 * 旧实现取 x-forwarded-for 最左值，客户端可伪造该头直接绕过限流，已废弃。
 */
export function getClientIp(req: NextRequest): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();

  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }

  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();

  return "unknown";
}
