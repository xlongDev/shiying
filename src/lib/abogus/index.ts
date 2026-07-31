import vm from "node:vm";
import crypto from "node:crypto";
import { SM3_SRC, CORE_SRC } from "./vendor";

/**
 * 抖音 a_bogus 签名生成（免浏览器 / 纯 Node）。
 *
 * 来源：github.com/ylcangel/douyin_sign（Apache-2.0），对应 JSVMP 版本
 * v1.0.1.19-fix.01。该算法已去除环境检测，但仍会读取 navigator/window 等
 * 浏览器对象，因此以 sloppy-mode 脚本形式在 vm 沙箱中执行。
 *
 * 用途：为 `aweme/v1/web/aweme/detail` 等需要签名的 Web 接口生成 a_bogus，
 * 从而在服务端（如 Vercel）无需无头浏览器即可拿到含实况照片动态短片 URL
 * 的完整 aweme 数据（Route C 的核心）。
 */

const PC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 递归 Proxy：为 a_bogus 提供"假浏览器环境"，未定义属性统一降级为 0 / ""，
// 避免 Node 端缺失 navigator/screen 等对象导致算法崩溃。
function createBrowserSandbox(userAgent: string): any {
  const target = function () {};
  // box 用于在 Proxy handler 闭包中延迟引用 proxy 自身（避免 prefer-const 误报，
  // 也规避 TDZ），未知属性统一返回同一个 proxy 以支持链式访问。
  const box: { proxy?: any } = {};
  const handler: ProxyHandler<any> = {
    get(t: any, p: PropertyKey) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === "toString") return () => "";
      if (p === "valueOf") return () => 0;
      if (p === "length") return 0;
      if (p in t) return t[p];
      return box.proxy;
    },
    set(t: any, p: PropertyKey, v: unknown) {
      t[p] = v;
      return true;
    },
    has() {
      return true;
    },
    apply() {
      return box.proxy;
    },
  };
  box.proxy = new Proxy(target, handler);
  box.proxy.userAgent = userAgent;
  box.proxy.vendorSubs = {};
  return box.proxy;
}

let sandbox: any = null;

function getSandbox(): any {
  if (sandbox) return sandbox;
  const navigator = createBrowserSandbox(PC_UA);
  const window = createBrowserSandbox(PC_UA);
  const ctx: any = {
    console,
    navigator,
    window,
    performance: { now: () => Date.now() },
    Date,
    Math,
    JSON,
    String,
    Array,
    Object,
    Number,
    Boolean,
    RegExp,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SM3_SRC, ctx, { filename: "sm3.js" });
  vm.runInContext(CORE_SRC, ctx, { filename: "abogus-core.js" });
  sandbox = ctx;
  return ctx;
}

/**
 * 生成 a_bogus 签名。
 * @param uri 待签名的查询字符串（不含 a_bogus 本身），例如 "aweme_id=123&a=1"
 * @param ts  时间戳（毫秒）；相同 uri+ts 应得到稳定结果
 */
export function generateABogus(uri: string, ts: number = Date.now()): string {
  const ctx = getSandbox();
  const code =
    '(function(){ programVersion="release"; return makeABogus(' +
    JSON.stringify(uri) +
    ", " +
    ts +
    "); })()";
  const result = vm.runInContext(code, ctx, { filename: "call.js" });
  if (typeof result !== "string" || result.length === 0) {
    throw new Error("generateABogus 生成失败，返回 " + JSON.stringify(result));
  }
  return result;
}

/**
 * 访问抖音首页以获取 ttwid cookie（aweme/detail 接口常需要该 cookie，否则返回空响应）。
 * 失败返回 null（调用方降级处理，不阻断主流程）。
 */
export async function fetchTtwid(): Promise<string | null> {
  try {
    const res = await fetch("https://www.douyin.com/", {
      headers: { "user-agent": PC_UA, accept: "text/html" },
      redirect: "follow",
    });
    const headers: any = res.headers;
    const setCookies: string[] = headers.getSetCookie?.() ?? [];
    const ttwidCookie = setCookies.find((c) => c.startsWith("ttwid="));
    return ttwidCookie ? ttwidCookie.split(";")[0] : null;
  } catch {
    return null;
  }
}

export interface SignedDetailRequest {
  url: string;
  headers: Record<string, string>;
  aBogus: string;
  ts: number;
  ttwid: string | null;
  ttwidSource: "real" | "synthetic" | "none";
}

/**
 * 生成一个合成 ttwid cookie（用于诊断：隔离"缺 cookie"与"IP 封锁"两种失败原因）。
 * 抖音服务端对 ttwid 的校验较宽松，常见爬虫直接发送任意合法格式 ttwid 即可通过
 * 身份门槛。真实格式为 `ttwid=1|<base64>`，此处用随机字节生成等价结构。
 */
export function generateSyntheticTtwid(): string {
  const rand = crypto.randomBytes(20).toString("base64").replace(/=+$/, "");
  return "ttwid=1|" + rand;
}

/**
 * 为 aweme/detail 构造带 a_bogus 签名的请求（标准 web 端查询参数）。
 * @param opts.forceSyntheticTtwid 为 true 时跳过首页 bootstrap，直接使用合成 ttwid，
 *        用于验证"空响应是否仅因缺少 ttwid"——若合成 ttwid 仍空响应，则必为 IP 封锁。
 */
export async function signAwemeDetail(
  awemeId: string,
  opts?: { forceSyntheticTtwid?: boolean }
): Promise<SignedDetailRequest> {
  const ts = Date.now();
  const query =
    "aid=6383&device_platform=webapp&channel=channel_pc_web&webid=local-" +
    "&aweme_id=" +
    awemeId +
    "&cursor=0&count=1&publish_video_strategy_type=2&pc_client_type=1";
  const aBogus = generateABogus(query, ts);
  let ttwid: string | null = null;
  let ttwidSource: "real" | "synthetic" | "none" = "none";
  if (opts?.forceSyntheticTtwid) {
    ttwid = generateSyntheticTtwid();
    ttwidSource = "synthetic";
  } else {
    ttwid = await fetchTtwid();
    ttwidSource = ttwid ? "real" : "none";
  }
  const url =
    "https://www.douyin.com/aweme/v1/web/aweme/detail/?" +
    query +
    "&a_bogus=" +
    encodeURIComponent(aBogus);
  const headers: Record<string, string> = {
    "user-agent": PC_UA,
    referer: "https://www.douyin.com/",
    accept: "application/json",
  };
  if (ttwid) headers.cookie = ttwid;
  return { url, headers, aBogus, ts, ttwid, ttwidSource };
}
