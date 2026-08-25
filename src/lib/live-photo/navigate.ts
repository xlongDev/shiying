/**
 * 实况照片浏览器兜底 —— 页面导航与 hydration 等待。
 *
 * 从 chrome.ts 抽出（其行为与 extractPhotosFromPage 等独立，仅依赖 puppeteer
 * Page 与 logger）。extractPhotosFromPage / extractLivePhotosFromRouterData 仍保留在
 * chrome.ts（其内部为 page.evaluate 回调，无法脱离浏览器上下文拆分）。
 */
import { logger } from "../logger";
import type { Page } from "puppeteer-core";

/**
 * 在已打开的页面上导航到抖音详情页并等待 hydration 完成。
 * 导航可能在数据中心 IP / 反爬挑战页 / SPA 客户端重定向下抛异常，这不代表页面无内容，
 * 但本兜底依赖 douyin.com 桌面端 React 注水后的数据，导航一旦失败即拿不到实况，
 * 返回 false 交由调用方按"无实况"处理。
 */
export async function navigateNotePage(
  page: Page,
  path: string,
  startTime: number
): Promise<boolean> {
  let gotoOk = true;
  try {
    await page.goto(`https://www.douyin.com${path}`, {
      waitUntil: "domcontentloaded",
      timeout: 12000,
    });
  } catch (gotoErr) {
    gotoOk = false;
    logger.warn(
      "live-photo",
      "页面导航未完成，放弃浏览器兜底:",
      (gotoErr as Error)?.message ?? gotoErr
    );
  }
  if (!gotoOk) return false;

  logger.info("live-page", `页面 DOM 加载完成 (${Date.now() - startTime}ms)`);

  // 等待 hydration：页面出现图片查看器或视频即代表数据已挂载
  try {
    await page.waitForFunction(
      () =>
        !!document.querySelector(".dySwiperSlide") ||
        !!document.querySelector(".note-detail-container") ||
        !!document.querySelector("video"),
      { timeout: 5000 }
    );
  } catch {
    // 超时也继续，下面仍有固定等待兜底
  }
  logger.info("live-page", `hydration 检测完成 (${Date.now() - startTime}ms)`);

  // 短暂等待 React 完成渲染与数据注入
  await new Promise((r) => setTimeout(r, 500));

  // 轮询等待 fiber 树中确实出现含 clipType/livePhotoType 的图片数组
  // （避免页面未完全 hydration 就遍历导致探测偶发返回空）
  try {
    await page.waitForFunction(
      () => {
        const seed =
          document.querySelector(".dySwiperSlide") ||
          document.querySelector(".note-detail-container") ||
          document.querySelector("video") ||
          document.body;
        const key = Object.keys(seed).find((k) => k.startsWith("__reactFiber"));
        if (!key) return false;
        const visited = new Set<unknown>();
        const stack: unknown[] = [(seed as unknown as Record<string, unknown>)[key]];
        let n = 0;
        while (stack.length && n < 30000) {
          const f = stack.pop() as Record<string, unknown> | undefined;
          n++;
          if (!f || typeof f !== "object" || visited.has(f)) continue;
          visited.add(f);
          const props = f.memoizedProps;
          if (props && typeof props === "object") {
            let found = false;
            const walk = (o: unknown) => {
              if (found || !o || typeof o !== "object") return;
              if (Array.isArray(o)) {
                if (
                  o.length > 0 &&
                  (o as unknown[]).every(
                    (x) =>
                      x &&
                      typeof x === "object" &&
                      ("clipType" in (x as Record<string, unknown>) ||
                        "livePhotoType" in (x as Record<string, unknown>) ||
                        "url_list" in (x as Record<string, unknown>) ||
                        "urlList" in (x as Record<string, unknown>) ||
                        "live_photo" in (x as Record<string, unknown>) ||
                        "livePhoto" in (x as Record<string, unknown>))
                  )
                ) {
                  found = true;
                  return;
                }
                o.forEach(walk);
                return;
              }
              for (const k of Object.keys(o)) {
                if (k.startsWith("__react")) continue;
                walk((o as Record<string, unknown>)[k]);
              }
            };
            walk(props);
            if (found) return true;
          }
          if (f.child) stack.push(f.child);
          if (f.sibling) stack.push(f.sibling);
          if (f.return) stack.push(f.return);
        }
        return false;
      },
      { timeout: 6000, polling: 800 }
    );
  } catch {
    // 超时也继续，下面的遍历仍有兜底
  }

  logger.info("live-page", `页面完全就绪，总耗时 ${Date.now() - startTime}ms`);
  return true;
}
