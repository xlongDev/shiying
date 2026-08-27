import vm from "node:vm";
import crypto from "node:crypto";
import { SM3_SRC, CORE_SRC } from "./vendor";
import { getBrowserCreds } from "../credentials-cache";

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
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

/**
 * 生成一个合法的 19 位数值型 web_id / device_id。
 * 抖音 web 端该字段为 19 位数字；发送 "local-" 之类占位符会被服务端拒收（表现为空响应）。
 * 进程内缓存复用，避免每次签名都换 id（部分接口对 id 稳定性有隐性要求）。
 */
let cachedWebId: string | null = null;
function makeWebId(): string {
  if (cachedWebId) return cachedWebId;
  // 1e18 ~ 9.99e18 之间，保证 19 位数字
  cachedWebId = String(Math.floor(1e18 + Math.random() * 9e18));
  return cachedWebId;
}

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

function getSandbox(): any {
  // 每次生成使用全新沙箱：a_bogus 核心脚本会在执行 makeABogus 时改写自身全局状态
  // （如 U 数组、程序计数器），复用沙箱会导致第二次签名被污染（非法字符/完全错误）。
  // vm 初始化 36KB 源码耗时 <1ms，性能可忽略，正确性优先。Vercel warm lambda 复用
  // 进程时这一点尤为关键。
  const navigator = createBrowserSandbox(PC_UA);
  const window = createBrowserSandbox(PC_UA);

  // 补齐 VM 实际读取的关键浏览器字段，使指纹更真实。原递归 proxy 对这些字段返回 ""/0，
  // 可能导致服务端判定签名环境异常而拒收（表现为空响应）。其余未知属性仍走递归 proxy 兜底，
  // 不影响 VM 正常执行。
  Object.assign(navigator, {
    userAgent: PC_UA,
    platform: "Win32",
    language: "zh-CN",
    languages: ["zh-CN", "zh"],
    hardwareConcurrency: 20,
    deviceMemory: 8,
    cookieEnabled: true,
    maxTouchPoints: 0,
    vendor: "Google Inc.",
    onLine: true,
  });
  Object.assign(window, {
    innerWidth: 2560,
    innerHeight: 1440,
    outerWidth: 2560,
    outerHeight: 1440,
    devicePixelRatio: 1,
    screenX: 0,
    screenY: 0,
    pageXOffset: 0,
    pageYOffset: 0,
    navigator,
    screen: { availWidth: 2560, availHeight: 1440, width: 2560, height: 1440 },
    location: {
      href: "https://www.douyin.com/",
      host: "www.douyin.com",
      hostname: "www.douyin.com",
      protocol: "https:",
      origin: "https://www.douyin.com",
    },
  });

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
 * 访问抖音首页以获取身份 cookie（ttwid / odin_tt / sid_tt / sessionid 等）。
 * aweme/detail 接口常需要这些 cookie，否则返回空响应（造成"IP 封锁"假象）。
 * 失败返回 null（调用方降级处理，不阻断主流程）。
 *
 * 结果缓存 30 分钟，避免每次解析请求都打一次首页（首页 bootstrap 也会消耗额度）。
 * ttwid 有效期通常远长于 30 分钟，复用安全。
 */
let cachedCookies: { value: string; ts: number } | null = null;
const COOKIE_TTL_MS = 30 * 60 * 1000;

const DESIRED_COOKIES = ["ttwid", "odin_tt", "sid_tt", "sessionid", "passport_csrf_token"];

export async function fetchTtwid(): Promise<string | null> {
  if (cachedCookies && Date.now() - cachedCookies.ts < COOKIE_TTL_MS) {
    return cachedCookies.value;
  }
  try {
    const res = await fetch("https://www.douyin.com/", {
      headers: { "user-agent": PC_UA, accept: "text/html" },
      redirect: "follow",
    });
    const setCookies: string[] = res.headers.getSetCookie?.() ?? [];
    const picked = setCookies
      .filter((c) => DESIRED_COOKIES.some((w) => c.startsWith(w + "=")))
      .map((c) => c.split(";")[0]);
    const cookie = picked.join("; ");
    if (cookie) {
      cachedCookies = { value: cookie, ts: Date.now() };
      return cookie;
    }
  } catch {
    // 忽略，返回 null
  }
  return null;
}

export interface SignedDetailRequest {
  url: string;
  headers: Record<string, string>;
  aBogus: string;
  ts: number;
  ttwid: string | null;
  ttwidSource: "real" | "synthetic" | "none";
  msTokenSource: "env" | "auto" | "browser";
  /** 凭证来源，用于日志 / 诊断区分走了哪条路径 */
  credSource: "browser" | "env" | "bootstrap" | "synthetic" | "none";
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
 * 从真实 ttwid cookie 中解析出内嵌的 web_id。
 *
 * ttwid 形如 `1|<base64>`，base64 解码后的载荷内嵌一个 17~19 位数字 web_id。
 * 抖音服务端会把请求参数里的 webid 与 ttwid 携带的 web_id 做一致性校验；
 * 若二者不符（例如我们用随机 webid 配真实 ttwid），会被判设备指纹伪造 → 拒收（空响应）。
 * 故真实 ttwid 场景下，参数 webid 必须取 ttwid 内嵌值，保持自洽。
 * 解析失败返回 null（调用方回退随机 19 位 webid）。
 */
function webidFromTtwid(ttwid: string | null): string | null {
  if (!ttwid) return null;
  // 入参可能是完整 cookie 片段 "ttwid=1|<payload>..."，先剥离 "ttwid=" 前缀，
  // 否则正则 ^1\|...$ 永远匹配不上 → webid 落回随机值，与 ttwid 内嵌 web_id 对不上
  // → 服务端判设备指纹伪造拒收（空响应）。
  const value = ttwid.startsWith("ttwid=") ? ttwid.slice("ttwid=".length) : ttwid;
  const m = value.match(/^1\|([A-Za-z0-9+/=_-]+)/);
  if (!m) return null;
  try {
    const buf = Buffer.from(m[1], "base64");
    // 载荷可能为 protobuf 或 JSON，统一按 latin1 扫描连续的 17~19 位数字串。
    const s = buf.toString("latin1");
    const digits = s.match(/\d{17,19}/);
    return digits ? digits[0] : null;
  } catch {
    return null;
  }
}

/**
 * 生成一个格式合规的「伪」msToken（128 字符：126 位随机字母数字 + "=="）。
 *
 * 为何需要：抖音 web 端 aweme/detail 等接口常要求携带 msToken，缺失会触发风控
 * 返回空响应（而非 JSON 报错）。msToken 由 bdms SDK 在浏览器内签发，纯 Node 难以
 * 复现其密码学校验载荷。但社区项目（JoeanAmier/TikTokDownloader、多款 douyin MCP）
 * 实测表明该端点对 msToken 多为「存在性 / 格式」校验，伪 token 即可解锁。
 *
 * 优先用真实 msToken（DOUYIN_MSTOKEN 环境变量，从浏览器 DevTools 抓一次永久有效），
 * 未配置时自动补伪 token，避免「缺 msToken → 空响应」假象掩盖真正的签名 / IP 问题。
 */
function makeFakeMsToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
  let s = "";
  for (let i = 0; i < 126; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s + "==";
}

/**
 * 生成 uifid（用户实例指纹，256 位十六进制串）。
 * 上游 ylcangel/douyin_sign 的 a_bogus uri 示例携带 uifid，且服务端会做 UA / 环境
 * 一致性校验；缺失 uifid 可能导致请求被拒。其值由 bdms SDK 在浏览器内签发，纯 Node
 * 难以复现密码学校验，但 uifid 主要用作追踪标识、服务端通常不严格校验其内容，
 * 故用等长的随机十六进制串即可通过格式/存在性检查。
 */
function makeUifid(): string {
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 256; i++) s += hex[Math.floor(Math.random() * 16)];
  return s;
}

/**
 * 为 aweme/detail 构造带 a_bogus 签名的请求（对齐抖音 web 端真实调用参数集）。
 *
 * 关键：a_bogus 是对「整个 query 字符串」做的校验和，服务端按相同参数集校验。
 * 早期实现只签了极小参数集、且 webid=local- 为非法占位符，导致服务端拒收（空响应）。
 * 这里补全抖音 web 端 aweme/detail 实际签名的参数集（request_source / origin_type /
 * update_version_code / timestamp 等，均来自成功命中请求的抓包），并使用合法 19 位
 * 数值 web_id。
 *
 * 关于 msToken：抖音 aweme/detail 近期常要求携带 msToken（由 bdms SDK 在浏览器内签发，
 * 无法纯 Node 生成）。缺失时服务端可能返回空响应。可从浏览器 DevTools 抓一次后通过
 * 环境变量 DOUYIN_MSTOKEN 注入；未配置时自动补「伪 msToken」（见 makeFakeMsToken），
 * 多数端点仅做存在性校验即可解锁。
 *
 * @param opts.forceSyntheticTtwid 为 true 时跳过首页 bootstrap，直接使用合成 ttwid，
 *        用于验证"空响应是否仅因缺少 ttwid"——若合成 ttwid 仍空响应，则必为 IP 封锁或签名失效。
 */
export async function signAwemeDetail(
  awemeId: string,
  opts?: { forceSyntheticTtwid?: boolean; useHarvestedCreds?: boolean }
): Promise<SignedDetailRequest> {
  const ts = Date.now();
  // 浏览器兜底会话中实时收割的、服务端已接受的同源自洽凭证（最快最稳，优先）。
  // useHarvestedCreds 仅诊断路由用于「强制走桥接路径」做对照实验。
  const harvested = getBrowserCreds();
  // 浏览器桥接路径启用条件： harvested 含任一真实会话字段（ttwid / odin_tt / webid /
  // verifyFp）即视为可用。「不强制要求 msToken」——抖音实测 aweme/detail 请求的
  // msToken 常不在 query 里（webmssdk 写入 cookie 或 JS 变量），导致收割到的凭证往往
  // 缺 msToken；此前错误地以 msToken 有无作为启用门槛，使桥接路径永远无法触发（始终
  // 回退到过期的 env 凭证 → 空响应）。msToken 缺失时在本分支内智能回退（env / 伪 token），
  // 其余真实同源字段照常复用，比过期 env 凭证更可能通过服务端自洽校验。
  const useHarvest =
    !!(harvested?.ttwid || harvested?.odin_tt || harvested?.webid || harvested?.verifyFp) &&
    (opts?.useHarvestedCreds || !opts?.forceSyntheticTtwid);

  const cookieParts: string[] = [];
  let webId: string;
  let msToken: string;
  let msTokenSource: "env" | "auto" | "browser";
  let ttwidSource: "real" | "synthetic" | "none";
  let credSource: "browser" | "env" | "bootstrap" | "synthetic" | "none";
  let verifyFp: string | undefined;
  let fp: string | undefined;

  if (useHarvest) {
    // 浏览器实时凭证桥接：整组 ttwid/odin_tt/msToken/webid/verifyFp/fp 均来自同一条
    // 服务端已接受的请求，天然自洽。这是让 a_bogus 真正生效的关键——手动从 DevTools
    // 各处复制的凭证分属不同会话，webid↔msToken↔verifyFp 同源校验必失败（200 空 body）。
    if (harvested!.ttwid) cookieParts.push(harvested!.ttwid);
    if (harvested!.odin_tt) cookieParts.push(harvested!.odin_tt);
    ttwidSource = harvested!.ttwid ? "real" : "none";
    // 优先用浏览器请求带的原生 webid（与 msToken 同源）；缺失时回退从 ttwid 解析。
    webId =
      harvested!.webid ||
      (harvested!.ttwid ? webidFromTtwid(harvested!.ttwid) : null) ||
      makeWebId();
    // msToken 优先用浏览器真实（同源）；缺失时回退 env 真实 token，再回退伪 token
    // 以通过「存在性」校验（多数端点仅做存在性校验）。verifyFp/fp/ttwid/webid 仍是
    // 真实同源值，比过期 env 凭证更可能通过服务端自洽校验。
    msToken = harvested!.msToken || process.env.DOUYIN_MSTOKEN?.trim() || makeFakeMsToken();
    msTokenSource = harvested!.msToken ? "browser" : process.env.DOUYIN_MSTOKEN ? "env" : "auto";
    verifyFp = harvested!.verifyFp;
    fp = harvested!.fp;
    credSource = "browser";
  } else if (opts?.forceSyntheticTtwid) {
    const synth = generateSyntheticTtwid();
    cookieParts.push(synth);
    ttwidSource = "synthetic";
    webId = makeWebId();
    const envMsToken = process.env.DOUYIN_MSTOKEN?.trim();
    msToken = envMsToken || makeFakeMsToken();
    msTokenSource = envMsToken ? "env" : "auto";
    credSource = "synthetic";
  } else {
    // 真实凭证优先从环境变量注入（用户从本机 Chrome DevTools 复制一次即可长期复用）。
    // 关键：自动 bootstrap（fetchTtwid 访问首页抓 Set-Cookie）在 WAF 环境会失败 → 返回 none，
    // 导致此路径一直用"无 ttwid + 伪 msToken"的请求，抖音静默返回 200 空 body（非 IP 封锁）。
    // 故开放 DOUYIN_TTWID / DOUYIN_ODIN_TT 让用户直接注入真实游客态 cookie，绕过首页 WAF 限制。
    const envCookie =
      [process.env.DOUYIN_TTWID, process.env.DOUYIN_ODIN_TT]
        .filter((v): v is string => !!v && v.trim().length > 0)
        .join("; ")
        .trim() || null;
    if (envCookie) {
      cookieParts.push(envCookie);
      ttwidSource = "real";
      credSource = "env";
    } else {
      const boot = await fetchTtwid();
      if (boot) cookieParts.push(boot);
      ttwidSource = boot ? "real" : "none";
      credSource = boot ? "bootstrap" : "none";
    }
    // 真实 ttwid 内嵌 web_id；若两者不一致，服务端判定设备指纹伪造 → 拒收（空响应）。
    // 故优先用 ttwid 中解析出的 webid（已修复 "ttwid=" 前缀导致永远匹配不上的 bug），
    // 解析失败再回退随机 19 位 webid。
    const decodedWebId = ttwidSource === "real" ? webidFromTtwid(cookieParts[0] ?? null) : null;
    webId = decodedWebId ?? makeWebId();
    const envMsToken = process.env.DOUYIN_MSTOKEN?.trim();
    msToken = envMsToken || makeFakeMsToken();
    msTokenSource = envMsToken ? "env" : "auto";
  }
  const ttwid = cookieParts.length ? cookieParts.join("; ") : null;

  const uifid = makeUifid();
  // 对齐抖音 web 端 aweme/detail 真实调用参数集，且与 UA（Windows Chrome 135）保持
  // 完全一致——服务端会做 UA / 平台 / 环境 一致性校验，UA 写 Windows 但 platform=Mac
  // 之类矛盾会被判伪造直接拒收（空响应）。参数取值对齐上游 ylcangel/douyin_sign 已验证
  // 可用的集合（含 uifid），并保留 request_source/origin_type 以保证返回数据。
  // a_bogus 对整个 query 字符串签名，服务端按相同参数集校验，签与发一致即可。
  const params: [string, string][] = [
    ["device_platform", "webapp"],
    ["aid", "6383"],
    ["channel", "channel_pc_web"],
    ["aweme_id", awemeId],
    ["request_source", "600"],
    ["origin_type", "video_page"],
    ["update_version_code", "170400"],
    ["pc_client_type", "1"],
    ["pc_libra_divert", "Windows"],
    ["support_h265", "1"],
    ["support_dash", "1"],
    ["cpu_core_num", "20"],
    ["version_code", "170400"],
    ["version_name", "17.4.0"],
    ["cookie_enabled", "true"],
    ["screen_width", "2560"],
    ["screen_height", "1440"],
    ["browser_language", "zh-CN"],
    ["browser_platform", "Win32"],
    ["browser_name", "Chrome"],
    ["browser_version", "135.0.0.0"],
    ["browser_online", "true"],
    ["engine_name", "Blink"],
    ["engine_version", "135.0.0.0"],
    ["os_name", "Windows"],
    ["os_version", "10"],
    ["device_memory", "8"],
    ["platform", "PC"],
    ["downlink", "0.55"],
    ["effective_type", "3g"],
    ["round_trip_time", "500"],
    ["webid", webId],
    ["uifid", uifid],
    ["timestamp", String(Math.floor(ts / 1000))],
  ];

  // msToken：浏览器桥接用真实（同源），否则优先环境变量真实 token，再回退伪 token
  // 以通过「存在性」校验，避免「缺 msToken → 空响应」假象掩盖真正的签名 / IP 问题。
  params.push(["msToken", msToken]);
  // 浏览器桥接路径补上 verifyFp/fp：抖音 aweme/detail 实际请求携带这两个字段，
  // 缺失可能导致空响应；手动/合成路径无此值则不发（避免伪造字段反而触发风控）。
  if (verifyFp) params.push(["verifyFp", verifyFp]);
  if (fp) params.push(["fp", fp]);

  const query = params.map(([k, v]) => `${k}=${v}`).join("&");
  // makeABogus 对 uri 做 SM3（uri 不以 "dhzx" 结尾时自动补），服务端按收到的
  // 完整请求（去掉 a_bogus）做相同 SM3 校验。抖音 web 端 a_bogus 签的是「query 串」，
  // 不含 host/path（对照上游 ylcangel/douyin_sign 的 uri 示例），故此处签 query 即可。
  const aBogus = generateABogus(query, ts);

  const url =
    "https://www.douyin.com/aweme/v1/web/aweme/detail/?" +
    query +
    "&a_bogus=" +
    encodeURIComponent(aBogus);
  // 补齐抖音 web 端真实浏览器会携带、而此前缺失的请求头。缺 origin / sec-ch-ua /
  // sec-fetch-* 时，服务端可能按「非浏览器 / 伪造请求」处理直接拒收（空响应）。
  // sec-ch-ua / platform 与 UA（Windows Chrome 135）保持一致。
  const headers: Record<string, string> = {
    "user-agent": PC_UA,
    accept: "application/json, text/plain, */*",
    "accept-language": "zh-CN,zh;q=0.9",
    origin: "https://www.douyin.com",
    referer: `https://www.douyin.com/video/${awemeId}`,
    "sec-ch-ua": `"Chromium";v="135", "Not-A.Brand";v="8", "Google Chrome";v="135"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": `"Windows"`,
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
  };
  if (ttwid) headers.cookie = ttwid;
  return { url, headers, aBogus, ts, ttwid, ttwidSource, msTokenSource, credSource };
}
