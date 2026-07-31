import { NextRequest, NextResponse } from "next/server";
import { signAwemeDetail } from "@/lib/abogus";

// 纯 Node / 服务端运行时；a_bogus 生成依赖 node:vm（不需要浏览器）。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 诊断路由：验证「免浏览器 Route C」在部署环境的真实 IP 上是否可用。
 *
 * 用法：GET /api/abogus-test?awemeId=<数字>
 * 返回 aweme/detail 的签名请求结果，重点看：
 *   - httpStatus / statusCode：接口是否放行（statusCode=0 表示成功）
 *   - hasDetail / imageCount / liveImageCount：是否返回含实况视频的 aweme
 *   - bodyLen：若=0 表示被反爬/缺 cookie 拦截（空响应）
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
    const sig = await signAwemeDetail(awemeId);
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

    return NextResponse.json({
      ok: true,
      httpStatus: res.status,
      statusCode,
      hasDetail,
      imageCount,
      liveImageCount,
      sampleLiveUrls,
      ttwid: sig.ttwid,
      aBogusLen: sig.aBogus.length,
      bodyLen: txt.length,
      note:
        "statusCode=0 且 liveImageCount>0 → 免浏览器 Route C 在您的 IP 可用；" +
        "bodyLen=0 / statusCode 非 0 → 仍被反爬或缺少 cookie 拦截，需换 IP 或补 msToken。",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
