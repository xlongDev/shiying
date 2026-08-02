/**
 * 解析后端能力探测。
 *
 * 本应用主解析链路为 SSR(Node fetch) → a_bogus 签名 API → 真实 Chrome 兜底。
 * 海外 / 无头环境下前两级通常失效，**唯一可靠路径是本地 Chrome**；若既无 Chrome
 * 又未配置国内签名服务（LIVE_PHOTO_SERVICE_URL），则主解析必然失败。本模块集中
 * 暴露该能力判断，供 /api/health 上报与 /api/parse 的 fail-fast 错误使用。
 */
import { findChromeExecutable } from "./chrome-finder";
import { config } from "./config";

export interface ParseCapability {
  /** 系统是否可找到 Chrome（决定浏览器兜底是否可用）。 */
  chromeAvailable: boolean;
  /** 是否配置了国内 IP 的 a_bogus 签名桥。 */
  serviceConfigured: boolean;
  /**
   * 降级：无 Chrome 且无国内服务。海外/无头部署下主解析确定失败，
   * 应在错误响应中明确告知而非返回笼统 400。
   */
  degraded: boolean;
}

export async function getParseCapability(): Promise<ParseCapability> {
  const chromeAvailable = (await findChromeExecutable()) !== null;
  const serviceConfigured = config.services.livePhotoServiceUrl != null;
  return {
    chromeAvailable,
    serviceConfigured,
    degraded: !chromeAvailable && !serviceConfigured,
  };
}
