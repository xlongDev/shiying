import { NextResponse } from "next/server";
import { getParseCapability } from "@/lib/parse-capability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 健康检查：上报当前环境的解析后端能力，便于运维/部署方确认
 * （自托管 Node + Chrome，或配置了国内签名服务的 Vercel 部署）是否就绪。
 *
 * - chrome: 是否找到系统 Chrome（浏览器兜底可用）
 * - livePhotoService: 是否配置 LIVE_PHOTO_SERVICE_URL（国内 IP 签名桥）
 * - degraded: 无 Chrome 且无服务 → 海外/无头环境下主解析必然失败
 */
export async function GET() {
  const cap = await getParseCapability();
  return NextResponse.json({
    ok: true,
    chrome: cap.chromeAvailable,
    livePhotoService: cap.serviceConfigured,
    degraded: cap.degraded,
    message: cap.degraded
      ? "解析后端不可用：请自托管并安装 Chrome，或配置 LIVE_PHOTO_SERVICE_URL（国内 IP 签名桥）"
      : "解析后端正常",
  });
}
