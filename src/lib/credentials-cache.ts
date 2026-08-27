/**
 * 浏览器会话凭证缓存（globalThis 单例）。
 *
 * 抖音 aweme/detail 等接口对「ttwid ↔ 内嵌 web_id ↔ webid 参数 ↔ verifyFp/fp ↔
 * msToken」做整组同源一致性校验，手动从 DevTools 各处复制的凭证天然对不齐，会静默
 * 返回 200 空 body（非 IP 封锁）。
 *
 * 根治方案：浏览器兜底成功命中 aweme/detail 时，从那条「服务端已接受的请求」里实时
 * 收割全部自洽凭证（msToken/webid/verifyFp/fp 来自请求 URL，ttwid/odin_tt 来自
 * 页面 cookie），缓存到本单例。后续 a_bogus Node 直连请求复用这组凭证，即可稳定命中，
 * 成为比浏览器兜底更快的主力路径（首请求走浏览器 ~4s，之后 a_bogus ~1-2s）。
 *
 * 用 globalThis 而非模块级变量，确保 Next.js 多模块实例 / 热重载下共享同一份缓存
 * （与 browser-pool 的共享浏览器单例同思路）。
 */

export interface HarvestedCreds {
  /** 完整 cookie 片段，如 "ttwid=1|..." */
  ttwid?: string;
  /** 完整 cookie 片段，如 "odin_tt=..." */
  odin_tt?: string;
  /** 真实 msToken（浏览器运行时由 webmssdk 签发） */
  msToken?: string;
  /** 浏览器请求带的 webid 参数（与 ttwid 内嵌 web_id 同源） */
  webid?: string;
  /** 浏览器请求带的 verifyFp 参数 */
  verifyFp?: string;
  /** 浏览器请求带的 fp 参数 */
  fp?: string;
  /** 收割时间戳，用于 TTL 失效判断 */
  ts: number;
}

/**
 * 凭证有效期：浏览器游客态会话通常维持数分钟到数十分钟。设 15 分钟在「少收割」
 * 与「避免过期卡死」之间取得平衡——配合 a_bogus 空响应时的 clearBrowserCreds 自愈，
 * 即便服务端提前让凭证失效，下一次请求也会重新收割，不会长期退化成浏览器兜底。
 */
const TTL_MS = 15 * 60 * 1000;

interface Store {
  creds: HarvestedCreds | null;
}

const g = globalThis as unknown as { __shiyingBrowserCreds?: Store };
function store(): Store {
  if (!g.__shiyingBrowserCreds) g.__shiyingBrowserCreds = { creds: null };
  return g.__shiyingBrowserCreds;
}

/**
 * 收割/合并浏览器会话凭证。仅覆盖非空的字段，保留既往有效字段（如某次只拿到
 * msToken 没拿到 ttwid 时，旧的 ttwid 仍保留），并刷新时间戳。
 */
export function harvestBrowserCreds(partial: Partial<HarvestedCreds>): void {
  const s = store();
  const cleaned: Partial<HarvestedCreds> = {};
  for (const [k, v] of Object.entries(partial)) {
    if (k === "ts") continue;
    if (v != null && String(v).length > 0) (cleaned as Record<string, unknown>)[k] = v;
  }
  s.creds = { ...(s.creds ?? {}), ...cleaned, ts: Date.now() };
}

/** 取仍在有效期内的浏览器会话凭证；过期或从未收割返回 null */
export function getBrowserCreds(): HarvestedCreds | null {
  const s = store();
  if (!s.creds) return null;
  if (Date.now() - s.creds.ts > TTL_MS) return null;
  return s.creds;
}

/** 测试 / 诊断用：清空缓存 */
export function clearBrowserCreds(): void {
  store().creds = null;
}
