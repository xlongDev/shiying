import { spawnSync } from "child_process";
import path from "path";
import os from "os";
import { logger } from "./logger";
import { config } from "./config";

/**
 * 查找系统中可用的 Chrome/Chromium 可执行文件路径。
 * 优先顺序：环境变量 PUPPETEER_EXECUTABLE_PATH / CHROME_PATH >
 *   常见安装路径 > which/where。
 *
 * 注意：SSR 扫描实况解析（resolveLivePhotosViaSsr）为主路径，无需浏览器；
 * 但主解析链路（SSR → a_bogus → Chrome 兜底）在海外 / 被 WAF 时前两级失效，
 * **唯一可靠路径是本地真实 Chrome**。因此 Chrome 是本应用的核心依赖：
 *   - 自托管 Node 服务：安装 Chrome 并设置 PUPPETEER_EXECUTABLE_PATH / CHROME_PATH；
 *   - Vercel 等无系统 Chrome 的 serverless 环境：因无浏览器，需配置
 *     LIVE_PHOTO_SERVICE_URL（部署在国内 IP 的 a_bogus 签名桥）才能解析。
 *
 * 仅通过 spawnSync 尝试拉起候选可执行文件判断可用性，不做 fs 读取，
 * 以规避 Next/Turbopack 构建期 NFT 全目录追踪告警。
 */
export async function findChromeExecutable(): Promise<string | null> {
  const envPath = config.chrome.executablePath;
  if (envPath && isExecutable(envPath)) return envPath;

  const platform = os.platform();
  const candidates: string[] = [];

  if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
    );
  } else if (platform === "win32") {
    const programFiles = [
      config.chrome.localAppData,
      config.chrome.programFiles,
      config.chrome.programFilesX86,
    ].filter(Boolean) as string[];
    for (const base of programFiles) {
      candidates.push(
        path.join(/*turbopackIgnore: true*/ base, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(
          /*turbopackIgnore: true*/ base,
          "Google",
          "Chrome SxS",
          "Application",
          "chrome.exe"
        ),
        path.join(/*turbopackIgnore: true*/ base, "Chromium", "Application", "chrome.exe"),
        path.join(/*turbopackIgnore: true*/ base, "Microsoft", "Edge", "Application", "msedge.exe")
      );
    }
  } else {
    // Linux
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome-beta",
      "/usr/bin/google-chrome-unstable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
      "/usr/bin/brave",
      "/snap/bin/chromium"
    );
  }

  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate;
  }

  // 尝试 which/where 命令
  try {
    const result = spawnSync(
      platform === "win32" ? "where" : "which",
      [platform === "win32" ? "chrome.exe" : "google-chrome"],
      { encoding: "utf-8", timeout: 5000 }
    );
    const found = result.stdout?.trim().split("\n")[0];
    if (found && isExecutable(found)) return found;
  } catch {
    // ignore
  }

  logger.warn(
    "chrome-finder",
    "未找到 Chrome：浏览器兜底不可用。自托管请安装 Chrome 并设置 PUPPETEER_EXECUTABLE_PATH / CHROME_PATH；部署到 Vercel 等无系统 Chrome 的 serverless 环境请配置 LIVE_PHOTO_SERVICE_URL（国内 IP 签名桥）。"
  );
  return null;
}

/**
 * 通过尝试以 --version 拉起候选可执行文件判断其是否存在且可用。
 * 使用 spawnSync（同步）而非 fs.existsSync，避免对动态路径做 fs 读取而触发
 * Next/Turbopack 构建期 NFT 全目录追踪告警；spawn 目标不被 nft 静态追踪。
 */
function isExecutable(candidate: string): boolean {
  try {
    const res = spawnSync(candidate, ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: "ignore",
    });
    return res.status === 0;
  } catch {
    return false;
  }
}
