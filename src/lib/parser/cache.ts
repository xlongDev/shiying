import type { ParsedVideo } from "./types";

interface CacheEntry {
  value: ParsedVideo;
  exp: number;
}

/** 解析结果缓存 TTL：5 分钟。抖音内容瞬时变化少，短时间命中可大幅降低上游 / Chrome 池压力与 p95 延迟。 */
const TTL_MS = 5 * 60 * 1000;
/** 最大缓存条目；超出按插入顺序（FIFO）淘汰最旧条目。 */
const MAX_ENTRIES = 500;

const store = new Map<string, CacheEntry>();

/**
 * 读取缓存。命中且未过期返回深拷贝（避免调用方就地修改污染缓存），
 * 否则清理过期条目并返回 null。
 */
export function getCachedParse(key: string): ParsedVideo | null {
  const now = Date.now();
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.exp <= now) {
    store.delete(key);
    return null;
  }
  return structuredClone(hit.value);
}

/** 写入缓存（仅在解析成功时调用）。 */
export function setCachedParse(key: string, value: ParsedVideo): void {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, exp: Date.now() + TTL_MS });
}
