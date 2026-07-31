import { NextRequest, NextResponse } from "next/server";
import { signAwemeDetail } from "@/lib/abogus";

// 纯 Node / 服务端运行时；a_bogus 生成依赖 node:vm（不需要浏览器）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AttemptResult {
  ttwidSource: "real" | "synthetic" | "none";
  httpStatus: number;
  statusCode: unknown;
  hasDetail: boolean;
  imageCount: number;
  liveImageCount: number;
  sampleLiveUrls: string[];
  aBogusLen: number;
  bodyLen: number;
}

async function attempt(awemeId: string, forceSyntheticTtwid: boolean): Promise<AttemptResult> {
  const sig = await signAwemeDetail(awemeId, { forceSyntheticTtwid });
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
    ttwidSource: sig.ttwidSource,
    httpStatus: res.status,
    statusCode,
    hasDetail,
    imageCount,
    liveImageCount,
    sampleLiveUrls,
    aBogusLen: sig.aBogus.length,
    bodyLen: txt.length,
  };
}

/**
 * 诊断路由：验证「免浏览器 Route C」在部署环境的真实 IP 上是否可用。
 *
 * 用法：GET /api/abogus-test?awemeId=<数字>
 *
 * 关键对照：同一请求分别用「真实 ttwid」（首页 bootstrap）与「合成 ttwid」各打一次
 * aweme/detail，结果并列返回，用于隔离两种失败原因：
 *   - 真实 ttwid 失败、合成 ttwid 成功 → 仅缺 cookie，补 ttwid 即可解锁
 *   - 两者都返回 bodyLen=0 → 必然是 IP 地理封锁，Route C 从本环境无解（需国内 IP）
 *
 * 这是诊断工具，不是生产路径；上线稳定后可删除。
 */
export async function GET(req: NextRequest) {
  const awemeId = (req.nextUrl.searchParams.get("awemeId") ?? "").trim();
  if (!/^\d{5,30}$/.test(awemeId)) {
    return NextResponse.json(
      { ok: false, error: "awemeId 非法（应为 5-30 位纯数字）" },
      { status: 400 }
    );
  }

  try {
    // 对照实验：真实 ttwid vs 合成 ttwid
    const realAttempt = await attempt(awemeId, false);
    const syntheticAttempt = await attempt(awemeId, true);

    const diagnose = (): string => {
      if (syntheticAttempt.liveImageCount > 0 && syntheticAttempt.statusCode === 0) {
        if (realAttempt.liveImageCount > 0) {
          return "两种 ttwid 均成功 → Route C 在您的 IP 可用，可直接接入生产。";
        }
        return "合成 ttwid 成功但真实 ttwid 失败 → 空响应仅因缺少 ttwid，补合成 ttwid 即可解锁 Route C。";
      }
      if (realAttempt.bodyLen === 0 && syntheticAttempt.bodyLen === 0) {
        return "真实 / 合成 ttwid 均返回空响应 → 必为 IP 地理封锁，Route C 从本环境无解，需换国内 IP 或改 Route B（国内云函数）。";
      }
      return "两者均未返回实况数据，但响应非空，可能为签名版本不匹配或参数问题，需进一步排查。";
    };

    return NextResponse.json({
      ok: true,
      awemeId,
      realTtwid: realAttempt,
      syntheticTtwid: syntheticAttempt,
      diagnose: diagnose(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
