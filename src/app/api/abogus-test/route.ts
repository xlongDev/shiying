import { NextRequest, NextResponse } from "next/server";
import { guardRateLimit } from "@/lib/rate-limit-guard";
import { config } from "@/lib/config";
import { signAwemeDetail } from "@/lib/abogus";
import { abogusReset, abogusRecordSuccess } from "@/lib/abogus/circuit";
import { getBrowserCreds } from "@/lib/credentials-cache";

// 纯 Node / 服务端运行时；a_bogus 生成依赖 node:vm（不需要浏览器）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AttemptResult {
  credSource: "browser" | "env" | "bootstrap" | "synthetic" | "none";
  ttwidSource: "real" | "synthetic" | "none";
  msTokenSource: "env" | "auto" | "browser";
  httpStatus: number;
  statusCode: unknown;
  hasDetail: boolean;
  imageCount: number;
  liveImageCount: number;
  sampleLiveUrls: string[];
  aBogusLen: number;
  bodyLen: number;
  bodySnippet: string;
}

async function attempt(
  awemeId: string,
  opts: { forceSyntheticTtwid?: boolean; useHarvestedCreds?: boolean }
): Promise<AttemptResult> {
  const sig = await signAwemeDetail(awemeId, opts);
  const res = await fetch(sig.url, { headers: sig.headers, redirect: "follow" });
  const txt = await res.text();

  let statusCode: unknown = null;
  let hasDetail = false;
  let imageCount = 0;
  let liveImageCount = 0;
  const sampleLiveUrls: string[] = [];
  try {
    const j = JSON.parse(txt) as Record<string, any>;
    statusCode = j.status_code;
    const d = j.aweme_detail as Record<string, any> | undefined;
    if (d) {
      hasDetail = true;
      const imgs: any[] = d.image_post_info?.images ?? d.images ?? [];
      imageCount = imgs.length;
      for (const im of imgs) {
        const v = im.video ?? im.live_photo_info?.video;
        const urls: string[] =
          v?.play_addr?.url_list ?? v?.bit_rate?.[0]?.play_addr?.url_list ?? [];
        if (urls.length > 0) {
          liveImageCount++;
          if (sampleLiveUrls.length < 3) sampleLiveUrls.push(urls[0].slice(0, 200));
        }
      }
    }
  } catch {
    // 解析失败则保持默认诊断值（bodyLen 会暴露异常响应）
  }

  return {
    credSource: sig.credSource,
    ttwidSource: sig.ttwidSource,
    msTokenSource: sig.msTokenSource,
    httpStatus: res.status,
    statusCode,
    hasDetail,
    imageCount,
    liveImageCount,
    sampleLiveUrls,
    aBogusLen: sig.aBogus.length,
    bodyLen: txt.length,
    bodySnippet: txt.slice(0, 300),
  };
}

const BOOTSTRAP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

/**
 * 探测「首页 bootstrap 自动获取 ttwid」在当前环境的真实情况（诊断用）。
 * 解释为什么真实 ttwid 路径常返回 ttwidSource="none"：首页被 WAF 或未下发 cookie。
 */
async function bootstrapProbe(): Promise<{
  httpStatus: number;
  setCookieCount: number;
  hasTtwid: boolean;
  hasOdinTt: boolean;
}> {
  try {
    const res = await fetch("https://www.douyin.com/", {
      headers: { "user-agent": BOOTSTRAP_UA, accept: "text/html" },
      redirect: "follow",
    });
    const sc = res.headers.getSetCookie?.() ?? [];
    const has = (p: string) => sc.some((c) => c.startsWith(p + "="));
    return {
      httpStatus: res.status,
      setCookieCount: sc.length,
      hasTtwid: has("ttwid"),
      hasOdinTt: has("odin_tt"),
    };
  } catch {
    return { httpStatus: 0, setCookieCount: 0, hasTtwid: false, hasOdinTt: false };
  }
}

/**
 * 诊断路由：验证「免浏览器 Route C」在部署环境的真实 IP 上是否可用。
 *
 * 用法：GET /api/abogus-test?awemeId=<数字>
 *
 * 安全：默认关闭，需设 ENABLE_DIAGNOSTICS=true 才响应（否则返回 404）。
 * 该路由会真实调用上游 aweme/detail 并返回内部签名细节，仅用于部署期排查，
 * 生产环境应关闭以缩减攻击面与信息泄露。
 *
 * 关键对照：同一请求分别用「真实 ttwid」（首页 bootstrap）与「合成 ttwid」各打一次
 * aweme/detail，结果并列返回，用于隔离失败原因：
 *   - 真实 ttwid 失败、合成 ttwid 成功 → 仅缺 cookie，补 ttwid 即可解锁
 *   - 两者都返回 bodyLen=0 且 httpStatus=200 → 签名已通过，空响应是「会话凭证无效」
 *     （ttwid 自动获取失败 + msToken 为伪 token），非 IP 封锁（浏览器兜底同 IP 能命中）；
 *     需注入真实 ttwid/odin_tt/msToken。仅当 httpStatus=403 才是 a_bogus 签名被拒。
 *
 * 这是诊断工具，不是生产路径；上线稳定后可删除。
 */
export async function GET(req: NextRequest) {
  // 诊断路由默认关闭：未设 ENABLE_DIAGNOSTICS=true 时返回 404，不暴露该路由存在。
  if (!config.features.enableDiagnostics) {
    return NextResponse.json({ ok: false, error: "诊断路由未启用" }, { status: 404 });
  }

  const blocked = await guardRateLimit(req, "abogus-test", 10, 60_000);
  if (blocked) return blocked;

  const awemeId = (req.nextUrl.searchParams.get("awemeId") ?? "").trim();
  if (!/^\d{5,30}$/.test(awemeId)) {
    return NextResponse.json(
      { ok: false, error: "awemeId 非法（应为 5-30 位纯数字）" },
      { status: 400 }
    );
  }

  try {
    // 诊断前强制重置熔断，确保本次对照实验不被既有熔断拦截，结果真实反映环境。
    abogusReset();

    // 探测首页 bootstrap 现状（解释真实 ttwid 为何常为 none）
    const bootstrap = await bootstrapProbe();

    // 对照实验：真实 ttwid vs 合成 ttwid vs 浏览器桥接（若已收割到凭证）
    const realAttempt = await attempt(awemeId, { forceSyntheticTtwid: false });
    const syntheticAttempt = await attempt(awemeId, { forceSyntheticTtwid: true });
    const harvestAttempt = await attempt(awemeId, { useHarvestedCreds: true });

    // 任一策略命中即视为链路可用，复位熔断（让生产路径恢复尝试）。
    if (
      realAttempt.liveImageCount > 0 ||
      syntheticAttempt.liveImageCount > 0 ||
      harvestAttempt.liveImageCount > 0
    ) {
      abogusRecordSuccess();
    }

    // 浏览器桥接凭证状态（来自 /api/parse 触发的浏览器兜底实时收割）
    const bc = getBrowserCreds();

    const diagnose = (): string => {
      // 关键判据：httpStatus=200 且 bodyLen=0 → 签名已被服务端接受（否则返回 403），
      // 空响应是「会话凭证无效」而非「IP 封锁」（浏览器兜底同 IP 能命中，已排除 IP 问题）。
      const msNote = `msToken=${realAttempt.msTokenSource === "env" ? "env真实" : "auto伪token"}, ttwid=${realAttempt.ttwidSource}`;
      if (harvestAttempt.liveImageCount > 0) {
        return "浏览器桥接路径命中 → a_bogus 已通过实时收割的浏览器会话凭证生效，生产路径将优先走此快速通道（首请求走浏览器 ~4s，之后 a_bogus ~1-2s）。";
      }
      if (realAttempt.liveImageCount > 0 || syntheticAttempt.liveImageCount > 0) {
        return "Route C 命中 → a_bogus 已生效，可直接接入生产。";
      }
      if (realAttempt.httpStatus === 403) {
        return `HTTP 403（${msNote}）→ a_bogus 被服务端拒。vendor sdkVersion 与上游 ylcangel/douyin_sign（2026-08 仍在维护、同版本）一致，版本过期概率低；更可能是本机 UA/环境指纹与请求参数仍不一致，或该 IP 已风控。`;
      }
      // httpStatus=200 但空 body：签名通过，缺有效会话凭证。
      const bridgeNote = bc
        ? `浏览器桥接凭证已存在（ttwid=${bc.ttwid ? "有" : "无"}, msToken=${bc.msToken ? "有" : "无"}, webid=${bc.webid ?? "无"}），应先跑一次真实 /api/parse 触发浏览器兜底收割，再测本路由的 harvestAttempt。`
        : `浏览器桥接凭证尚未收割：请先在本机通过前端跑一次真实解析（/api/parse），浏览器兜底成功后即实时收割自洽凭证，之后 a_bogus 自动复用。`;
      return `HTTP 200 但空 body（${msNote}）→ 签名已通过，空响应是「会话凭证无效」而非 IP 封锁（浏览器兜底同 IP 能命中已证实）。${bridgeNote} 当前 bootstrap 探测得首页 HTTP ${bootstrap.httpStatus}、Set-Cookie ${bootstrap.setCookieCount} 个（含 ttwid=${bootstrap.hasTtwid}）。`;
    };

    return NextResponse.json({
      ok: true,
      awemeId,
      msTokenConfigured: !!process.env.DOUYIN_MSTOKEN,
      browserCredsHarvested: !!bc,
      browserCreds: bc
        ? {
            ttwid: bc.ttwid ? "set" : "missing",
            odin_tt: bc.odin_tt ? "set" : "missing",
            msToken: bc.msToken ? "set" : "missing",
            webid: bc.webid ?? "missing",
            verifyFp: bc.verifyFp ?? "missing",
            fp: bc.fp ?? "missing",
            ageSec: Math.round((Date.now() - bc.ts) / 1000),
          }
        : null,
      bootstrap,
      realTtwid: realAttempt,
      syntheticTtwid: syntheticAttempt,
      browserBridge: harvestAttempt,
      diagnose: diagnose(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
