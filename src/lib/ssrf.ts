/**
 * SSRF 防护：只允许访问白名单内的抖音 / TikTok CDN 主机，
 * 并对解析出的 IP 做内网 / 保留地址校验。
 */

/** 允许的抖音 / TikTok CDN 主机后缀（含多级域名，如 capi.douyin.com、aweme.snssdk.com）。 */
export const ALLOWED_HOST_SUFFIXES: string[] = [
  "douyin.com",
  "iesdouyin.com",
  "snssdk.com",
  "douyinpic.com",
  "byteimg.com",
  "zjcdn.com",
  "bytecdn.com",
  "aweme.com",
  "douyinstatic.com",
  "douyinvod.com",
  "tiktok.com",
  "tiktokcdn.com",
  "ibytedtos.com",
  "muscdn.com",
  "capi.douyin.com",
  "aweme.snssdk.com",
];

/**
 * 判断一个 IP 是否为私网 / 保留 / 本地地址。
 * 命中以下任一范围即返回 true：
 *   IPv4：10.0.0.0/8、172.16.0.0/12、192.168.0.0/16、127.0.0.0/8、
 *         169.254.0.0/16、0.0.0.0/8、100.64.0.0/10
 *   IPv6：::1、::、fc00::/7（fc/fd 前缀）、fe80::/10（链路本地）
 *         以及 ::ffff:<IPv4> 形式的 IPv4 映射地址（递归判定）
 * 无法解析的非法地址一律按私有地址处理（拒绝）。
 */
export function isPrivateIp(ip: string): boolean {
  // 去掉 IPv6 作用域标识（如 %eth0）与方括号
  const clean = ip.replace(/[%][^%]*$/, "").replace(/^\[|\]$/g, "");

  // IPv6 路径
  if (clean.includes(":")) {
    const lower = clean.toLowerCase();
    if (lower === "::1") return true; // 回环
    if (lower === "::") return true; // 未指定地址（等价于 0.0.0.0）
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
    if (lower.startsWith("fe80")) return true; // 链路本地 fe80::/10
    // IPv4 映射地址（::ffff:a.b.c.d），递归判定内层 IPv4
    if (lower.startsWith("::ffff:")) {
      return isPrivateIp(lower.slice("::ffff:".length));
    }
    return false;
  }

  // IPv4 路径
  const parts = clean.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    return true; // 非法地址，按私有拒绝
  }
  // 八位组越界（如 256.1.1.1）同为非法地址，按私有拒绝
  if (parts.some((n) => n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 127) return true; // 127.0.0.0/8 回环
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 链路本地
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

/**
 * 校验一个 URL 是否为允许访问的上游目标。
 *
 * 流程：
 *   1. 必须由 new URL() 成功解析，且协议为 http/https；
 *   2. 主机名必须以 ALLOWED_HOST_SUFFIXES 中某一后缀结尾（含多级域名）；
 *   3. 解析主机名得到的所有 IP 均不能是私网 / 保留地址。
 *
 * 任意一步失败都返回 false（调用方应拒绝代理）。
 *
 * 注意（DNS 重绑定限制）：我们在请求发起前解析并校验 IP，但攻击者理论上可在
 * 本次校验与真正 fetch 上游之间将域名重新绑定到内网地址（TOCTOU）。
 * 对本工具而言，主机名白名单已将该风险面收敛到已知 CDN 域名，残余风险可接受。
 */
export async function isAllowedTarget(input: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  const host = url.hostname.toLowerCase();
  const suffixOk = ALLOWED_HOST_SUFFIXES.some((s) => host === s || host.endsWith("." + s));
  if (!suffixOk) return false;

  try {
    const dns = await import("node:dns");
    const records = await dns.promises.lookup(host, { all: true });
    for (const record of records) {
      if (isPrivateIp(record.address)) return false;
    }
  } catch {
    // 解析失败（含 ENOTFOUND / EAI_AGAIN 等）一律拒绝，避免代理到不可信目标。
    return false;
  }

  return true;
}
