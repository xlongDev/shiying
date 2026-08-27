/**
 * 统一获取抖音 aweme item（完整视频/图文元数据）。
 *
 * 提供多源 fallback，以应对抖音对单一来源的反爬/封锁：
 *   1) SSR 分享页（iesdouyin.com/share/{note|video}/{id}/）—— 无需签名，但可能被 WAF；
 *   2) a_bogus 签名 API（www.douyin.com/aweme/v1/web/aweme/detail/）—— 需国内 IP；
 *   3) 桌面版无头浏览器（本地有 Chrome 时）—— 通用兜底，绕过 WAF/地理封锁，但慢且 Vercel 不可用。
 *
 * note.ts / slides.ts / live-photo-resolver.ts / download-music.ts 统一从这里取 item，
 * 避免各模块重复实现不一致的提取/兜底逻辑。
 */

import { signAwemeDetail } from "@/lib/abogus";
import {
  abogusShouldSkip,
  abogusRecordSuccess,
  abogusRecordFailure,
  abogusReset,
} from "@/lib/abogus/circuit";
import { loadRouterDataViaBrowser, isPrewarmPending, awaitPrewarm } from "../browser-router-data";
import { clearBrowserCreds, getBrowserCreds } from "../credentials-cache";
import { logger } from "@/lib/logger";
import { fetchWithTimeout } from "../http";
import { config } from "@/lib/config";
import { MOBILE_UA, extractRouterData, findItemInRouterData } from "./extract";

/** 判断响应是否为抖音 WAF JS Challenge 页（非正常的 SSR 分享页） */
function isWafResponse(html: string): boolean {
  const marker = html.slice(0, 6000).toLowerCase();
  return (
    marker.includes("waf_js") ||
    marker.includes("wafchallengeid") ||
    marker.includes("argus-csp-token") ||
    marker.includes("/waf-jschallenge/")
  );
}

/** 从 iesdouyin 分享页 SSR 读取完整 aweme item */
async function fetchAwemeItemFromSsr(awemeId: string): Promise<Record<string, unknown> | null> {
  const candidates = [
    `https://www.iesdouyin.com/share/note/${awemeId}/`,
    `https://www.iesdouyin.com/share/video/${awemeId}/`,
  ];

  for (const shareUrl of candidates) {
    try {
      const res = await fetchWithTimeout(shareUrl, {
        timeoutMs: 15000,
        headers: {
          "user-agent": MOBILE_UA,
          accept: "text/html",
          "accept-language": "zh-CN,zh;q=0.9",
          referer: "https://www.douyin.com/",
        },
      });
      if (!res.ok) {
        logger.warn("aweme-detail", `SSR ${shareUrl} HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      if (isWafResponse(html)) {
        logger.warn("aweme-detail", `SSR ${shareUrl} 被 WAF 拦截`);
        continue;
      }
      const rd = extractRouterData(html);
      if (!rd) {
        logger.warn("aweme-detail", `SSR ${shareUrl} 无 _ROUTER_DATA`);
        continue;
      }
      const item = findItemInRouterData(rd);
      if (item) return item;
    } catch (err) {
      logger.warn("aweme-detail", `SSR ${shareUrl} 失败:`, err);
    }
  }
  return null;
}

/**
 * 按既定策略顺序尝试 a_bogus 签名 API（纯 Node，零 Chrome 依赖）。
 * 任一策略命中即返回 aweme item；全部失败返回 null（由上层决定是否重试 / 浏览器兜底）。
 */
async function tryStrategies(awemeId: string): Promise<Record<string, unknown> | null> {
  const strategies: { name: string; opts?: { forceSyntheticTtwid?: boolean } }[] = [
    { name: "真实cookie(ttwid+odin_tt)" },
    { name: "合成ttwid", opts: { forceSyntheticTtwid: true } },
  ];

  for (const s of strategies) {
    try {
      const sig = await signAwemeDetail(awemeId, s.opts);
      const res = await fetchWithTimeout(sig.url, {
        timeoutMs: 15000,
        headers: sig.headers,
        redirect: "follow",
      });
      if (!res.ok) {
        logger.warn(
          "aweme-detail",
          `a_bogus[${s.name}] HTTP ${res.status} cred=${sig.credSource} ttwid=${sig.ttwidSource} msToken=${sig.msTokenSource}`
        );
        continue;
      }
      const txt = await res.text();
      if (!txt || txt.length < 100) {
        // 浏览器兜底同 IP 能命中 → 绝非 IP 地理封锁；空响应只可能是签名被拒或会话/msToken 失效。
        logger.warn(
          "aweme-detail",
          `a_bogus[${s.name}] 空响应(非IP问题) http=${res.status} bodyLen=${txt.length} cred=${sig.credSource} ttwid=${sig.ttwidSource} msToken=${sig.msTokenSource}`
        );
        // 自愈：桥接凭证若已失效（空响应），清空缓存让浏览器兜底重收割，
        // 避免过期凭证永久卡住每个请求都退化成浏览器兜底。
        if (sig.credSource === "browser") clearBrowserCreds();
        continue;
      }
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(txt);
      } catch {
        logger.warn("aweme-detail", `a_bogus[${s.name}] 返回非 JSON（疑似 WAF）`);
        continue;
      }
      if (json.status_code !== 0) {
        logger.warn("aweme-detail", `a_bogus[${s.name}] status_code=${json.status_code}`);
        continue;
      }
      const detail = json.aweme_detail as Record<string, unknown> | undefined;
      if (!detail || typeof detail !== "object") {
        logger.warn("aweme-detail", `a_bogus[${s.name}] 无 aweme_detail`);
        continue;
      }
      logger.info("aweme-detail", `a_bogus 命中(${s.name})`);
      abogusRecordSuccess();
      return detail;
    } catch (err) {
      logger.warn("aweme-detail", `a_bogus[${s.name}] 异常:`, err);
    }
  }
  return null;
}

/**
 * 从 a_bogus 签名 API 读取完整 aweme item（国内 IP 可用，零 Chrome 依赖）。
 *
 * 多策略重试，按"成功率"排序：
 *   1) 真实 cookie（首页 bootstrap 拿 ttwid+odin_tt 等）—— 最像真用户，国内 IP 首选；
 *   2) 合成 ttwid —— 真实 cookie 失败时（首页被 WAF / 超时）的兜底。
 * 每步记录精确失败原因（HTTP 状态 / 空响应=IP封锁 / status_code≠0=签名或参数 / 非JSON=WAF），
 * 便于在国内部署机通过日志或 /api/abogus-test 路由定位问题。
 *
 * 首条请求早于预热带完成时的优化：冷启动后第一条 /api/parse 常在浏览器预热带
 * （prewarmBrowserCreds）收割到自洽凭证之前到达，此时缓存为空 → a_bogus 退回
 * 已过期的 env 凭证 → 空响应 → 被迫走 ~4s 的浏览器兜底。若预热带仍在进行且凭证
 * 未就绪，这里会短暂等待其写入凭证（通常 <2s）后重试一次 a_bogus；命中后即走最快
 * 的 Node 签名路径，比并行启动更贵的浏览器兜底更快，也更省一个 page 信号量。
 */
async function fetchAwemeItemFromApi(awemeId: string): Promise<Record<string, unknown> | null> {
  // 熔断：a_bogus 在本环境稳定失败时，跳过本次两次上游请求（省 ~0.8s），冷却后必重试。
  if (abogusShouldSkip()) {
    logger.warn("aweme-detail", "a_bogus 熔断中（连续失败），跳过本次签名 API 尝试");
    return null;
  }

  // 第一次尝试（此时预热带可能尚未把自洽凭证写入缓存）
  let item = await tryStrategies(awemeId);
  if (item) return item;

  // 首条请求早于预热带完成：a_bogus 此时退回过期 env 凭证 → 空响应。
  // 若预热带仍在进行，短暂等待其写入自洽凭证后再试一次，通常 <2s 命中，
  // 比直接掉 ~4s 浏览器兜底更快，且不额外占用 page 信号量。
  if (!getBrowserCreds() && isPrewarmPending()) {
    await awaitPrewarm(8000);
    if (abogusShouldSkip()) return null;
    item = await tryStrategies(awemeId);
    if (item) return item;
  }

  // 所有策略（含预热后重试）均失败：累加熔断计数（达阈值后开启冷却，冷却结束必重试）。
  abogusRecordFailure();
  return null;
}

/**
 * 多源获取 aweme item。
 * @param opts.type 链接类型（video/note/slides），用于浏览器兜底候选排序：
 *   视频链接优先试 douyin.com/video（稳定命中 aweme/detail 提前返回），避免先试错
 *   note 候选白耗数秒；图文链接优先试 iesdouyin/note（SSR 最快）。
 * @returns 完整 item 对象，或 null（表示当前网络环境无法获取）
 */
export async function fetchAwemeItem(
  awemeId: string,
  opts?: { type?: "video" | "note" | "slides" }
): Promise<Record<string, unknown> | null> {
  // 路径 1：SSR（最快，无需签名）
  const ssrItem = await fetchAwemeItemFromSsr(awemeId);
  if (ssrItem) return ssrItem;

  // 路径 2：a_bogus 签名 API（国内 IP 可用，海外会空响应）
  logger.warn("aweme-detail", "SSR 未命中，回退 a_bogus 签名 API");
  const apiItem = await fetchAwemeItemFromApi(awemeId);
  if (apiItem) return apiItem;

  // 路径 3：无头浏览器（本地有 Chrome 时）—— 绕过 WAF / 地理封锁的通用兜底
  if (config.features.disableBrowserFallback) {
    logger.info("aweme-detail", "浏览器兜底已禁用(DISABLE_BROWSER_FALLBACK)，跳过");
  } else {
    logger.warn("aweme-detail", "SSR + a_bogus 均未命中，回退无头浏览器");
    const browserItem = await loadRouterDataViaBrowser(awemeId, { type: opts?.type });
    if (browserItem) {
      // 浏览器兜底成功 → 已实时收割自洽会话凭证（见 credentials-cache）。
      // 重置 a_bogus 熔断，让后续请求立即走更快的 a_bogus 桥接路径，而非继续每次都拉浏览器。
      abogusReset();
      return browserItem;
    }
  }

  return null;
}
