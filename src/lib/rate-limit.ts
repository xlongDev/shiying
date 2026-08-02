/**
 * 请求限流（可切换存储后端）。
 *
 * 作为公开解析 API 的第一道闸，防止被刷量 / 成本失控（无头浏览器 + SSR fetch
 * 均为高成本操作）。
 *
 * 存储后端：
 *   - 默认：进程内存固定窗口（MemoryRateLimiter），单实例维度已能挡住绝大多数滥用；
 *   - 跨实例：配置 UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN 后自动切换到
 *     Upstash Ratelimit（@upstash/ratelimit + @upstash/redis），解决 serverless 多实例
 *     下内存不共享、限流可被轮换实例绕过的问题。
 *
 * 依赖说明：@upstash/ratelimit / @upstash/redis 为**可选依赖**，仅在启用 Upstash 时需要。
 * 通过 `new Function` 运行时加载，构建工具不会静态解析该 import，因此未安装包
 * 也能正常构建；运行时若包缺失则自动回退内存限流。启用时请先
 * `pnpm add @upstash/ratelimit @upstash/redis`。
 */
import { logger } from "./logger";
import { config } from "./config";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface RateLimiter {
  limit(key: string): Promise<RateLimitResult>;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

/** 内存固定窗口限流（默认后端，保留原行为）。 */
class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, WindowEntry>();

  constructor(
    private readonly maxLimit: number,
    private readonly window: number
  ) {
    const timer = setInterval(() => this.prune(), 5 * 60 * 1000) as unknown as {
      unref?: () => void;
    };
    timer.unref?.();
  }

  async limit(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const entry = this.buckets.get(key);

    if (!entry || entry.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.window });
      return { allowed: true, remaining: this.maxLimit - 1, retryAfterMs: 0 };
    }

    if (entry.count >= this.maxLimit) {
      return { allowed: false, remaining: 0, retryAfterMs: entry.resetAt - now };
    }

    entry.count += 1;
    return { allowed: true, remaining: this.maxLimit - entry.count, retryAfterMs: 0 };
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, v] of this.buckets) {
      if (v.resetAt <= now) this.buckets.delete(k);
    }
  }
}

/**
 * 运行时动态加载可选模块，避免 Next.js / webpack / Turbopack 在构建阶段静态分析
 * import() 目标并在包未安装时报错。
 */
async function loadOptionalModule(name: string): Promise<unknown> {
  try {
    const runtimeImport = new Function("path", "return import(path)") as (
      path: string
    ) => Promise<unknown>;
    return await runtimeImport(name);
  } catch {
    return null;
  }
}

/**
 * 创建 Upstash Ratelimit 后端（滑动窗口）。
 * 未安装依赖或初始化失败时返回 null，由调用方回退内存限流。
 */
async function createUpstashLimiter(
  url: string,
  token: string,
  limit: number,
  windowMs: number
): Promise<RateLimiter | null> {
  const [ratelimitMod, redisMod] = await Promise.all([
    loadOptionalModule("@upstash/ratelimit"),
    loadOptionalModule("@upstash/redis"),
  ]);

  const Ratelimit = (ratelimitMod as any)?.Ratelimit;
  const slidingWindow = (ratelimitMod as any)?.slidingWindow;
  const Redis = (redisMod as any)?.Redis;

  if (!Ratelimit || !Redis || !slidingWindow) {
    logger.warn(
      "rate-limit",
      "未检测到 @upstash/ratelimit / @upstash/redis，回退内存限流。" +
        "如需跨实例限流请先 pnpm add @upstash/ratelimit @upstash/redis"
    );
    return null;
  }

  const redis = new Redis({ url, token });
  const rl = new Ratelimit({
    redis,
    limiter: slidingWindow(limit, `${Math.round(windowMs / 1000)} s`),
    prefix: "shiying_rl",
    analytics: false,
  });

  return {
    async limit(key: string): Promise<RateLimitResult> {
      const res = await rl.limit(key);
      return {
        allowed: res.success,
        remaining: res.remaining,
        retryAfterMs: Math.max(0, res.reset - Date.now()),
      };
    },
  };
}

const limiterCache = new Map<string, RateLimiter>();
const initPromises = new Map<string, Promise<RateLimiter>>();

async function getLimiter(limit: number, windowMs: number): Promise<RateLimiter> {
  const cacheKey = `${limit}:${windowMs}`;
  const cached = limiterCache.get(cacheKey);
  if (cached) return cached;
  const pending = initPromises.get(cacheKey);
  if (pending) return pending;

  const p = (async () => {
    const { url, token } = config.upstash;
    if (url && token) {
      const rl = await createUpstashLimiter(url, token, limit, windowMs);
      if (rl) {
        limiterCache.set(cacheKey, rl);
        logger.info("rate-limit", "已启用 Upstash 跨实例限流");
        return rl;
      }
    }
    const mem = new MemoryRateLimiter(limit, windowMs);
    limiterCache.set(cacheKey, mem);
    return mem;
  })();

  initPromises.set(cacheKey, p);
  // 解析完成后清理 pending，避免悬挂引用
  p.finally(() => initPromises.delete(cacheKey));
  return p;
}

/**
 * 固定窗口 / 滑动窗口限流（依后端而定）。
 * @param key   限流维度（通常按客户端 IP）
 * @param limit 窗口内最大允许请求数
 * @param windowMs 窗口时长（毫秒）
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const limiter = await getLimiter(limit, windowMs);
  return limiter.limit(key);
}
