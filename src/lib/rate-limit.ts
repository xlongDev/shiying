/**
 * 轻量级内存固定窗口限流（无第三方依赖）。
 *
 * 作用：作为公开解析 API 的第一道闸，防止被刷量 / 成本失控（无头浏览器 + SSR
 * fetch 均为高成本操作）。
 *
 * 局限：serverless 多实例下内存不共享，无法做跨实例精确限流。若需全局精确限流，
 * 应接入 Redis / Upstash 等外部存储。本实现在单实例维度已能有效挡住绝大多数滥用。
 */

interface WindowEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, WindowEntry>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * 固定窗口限流。
 * @param key   限流维度（通常按客户端 IP）
 * @param limit 窗口内最大允许请求数
 * @param windowMs 窗口时长（毫秒）
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: entry.resetAt - now };
  }

  entry.count += 1;
  return { allowed: true, remaining: limit - entry.count, retryAfterMs: 0 };
}

/** 清理过期桶，避免内存无限增长。 */
function pruneBuckets(): void {
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

// 每 5 分钟清理一次；unref 避免阻止进程退出。
const pruneTimer = setInterval(pruneBuckets, 5 * 60 * 1000) as unknown as { unref?: () => void };
pruneTimer.unref?.();
