/**
 * 带超时的 fetch 工具（二次防护）。
 *
 * 背景：Node 的全局 fetch（undici）默认**无超时**。抖音上游（iesdouyin / douyin）
 * 偶发连接挂起或极慢响应时，解析链会永久阻塞，进而拖垮自托管单实例的解析能力。
 * 本工具用 AbortController 在超时后主动中止请求，把"上游不可达"收敛为可捕获异常，
 * 交由各调用方的 fallback 链（SSR → a_bogus → 本地 Chrome）继续降级。
 *
 * 注意：当前调用方均不传入自定义 signal；如未来需要合并外部 signal，请用
 * AbortSignal.any 处理，否则本工具的 controller.signal 会覆盖调用方的中止逻辑。
 */
export interface FetchWithTimeoutOptions extends RequestInit {
  /** 超时毫秒数，默认 15000。超时后通过 AbortController 中止请求。 */
  timeoutMs?: number;
}

const DEFAULT_FETCH_TIMEOUT_MS = 15000;

/**
 * 带超时的 fetch。超时触发 AbortController.abort()，fetch 抛 AbortError，
 * 由调用方 try/catch 捕获并按 fallback 逻辑处理。
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
