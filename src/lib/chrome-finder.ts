import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { logger } from "./logger";

/**
 * 查找系统中可用的 Chrome/Chromium 可执行文件路径。
 * 优先顺序：环境变量 PUPPETEER_EXECUTABLE_PATH / CHROME_PATH >
 *   常见安装路径 > which/where > serverless 回退 @sparticuz/chromium。
 *
 * serverless（Vercel 等）默认无系统 Chrome：部署时安装可选依赖
 * @sparticuz/chromium 即可启用实况照片解析；否则返回 null，调用方优雅降级。
 */
export async function findChromeExecutable(): Promise<string | null> {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

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
      process.env.LOCALAPPDATA,
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
    ].filter(Boolean) as string[];
    for (const base of programFiles) {
      candidates.push(
        path.join(base, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(base, "Google", "Chrome SxS", "Application", "chrome.exe"),
        path.join(base, "Chromium", "Application", "chrome.exe"),
        path.join(base, "Microsoft", "Edge", "Application", "msedge.exe")
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
    if (fs.existsSync(candidate)) return candidate;
  }

  // 尝试 which/where 命令
  try {
    const result = spawnSync(
      platform === "win32" ? "where" : "which",
      [platform === "win32" ? "chrome.exe" : "google-chrome"],
      { encoding: "utf-8", timeout: 5000 }
    );
    const found = result.stdout?.trim().split("\n")[0];
    if (found && fs.existsSync(found)) return found;
  } catch {
    // ignore
  }

  // serverless 回退：@sparticuz/chromium（仅在部署时安装该可选依赖后生效）。
  // Vercel 等无系统 Chrome 的环境需安装 @sparticuz/chromium 才能启用实况照片解析。
  try {
    const spec: string = "@sparticuz/chromium";
    const chromiumMod = (await import(/* @vite-ignore */ spec).catch(() => null)) as {
      default?: {
        executablePath: (input?: string) => Promise<string>;
        setGraphicsMode?: (v: boolean) => void;
      };
    } | null;
    const Chromium = chromiumMod?.default;
    if (Chromium?.executablePath) {
      // 关闭 graphics/WebGL 栈，减少 /tmp 解压体积（headless 抓取无需 WebGL）
      try {
        Chromium.setGraphicsMode?.(false);
      } catch {
        /* 某些版本无该 setter，忽略 */
      }
      const p = await Chromium.executablePath();
      if (p && fs.existsSync(p)) return p;
    }
  } catch {
    /* 未安装 @sparticuz/chromium，忽略 */
  }

  logger.warn(
    "chrome-finder",
    "未找到 Chrome：实况照片解析将不可用。自托管请安装 Chrome 并设置 PUPPETEER_EXECUTABLE_PATH / CHROME_PATH；部署到 Vercel 等无系统 Chrome 的环境请安装可选依赖 @sparticuz/chromium。"
  );
  return null;
}
