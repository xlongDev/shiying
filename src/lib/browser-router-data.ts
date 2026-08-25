/**
 * 无头浏览器兜底：当 SSR（iesdouyin）与 a_bogus 签名 API 均不可用时，
 * 用真实 Chrome 加载抖音桌面页面，读取渲染后的 window._ROUTER_DATA 或遍历 React
 * fiber 取得完整 aweme item。
 *
 * 为何需要这一环：
 *  - 抖音对裸 Node fetch 的 iesdouyin 分享页会做 WAF（首请求放行、同 IP 后续挑战），
 *    且 a_bogus 签名 API 在海外 IP 会被地理封锁、返回空响应；
 *  - 真实 Chrome 具备正确 TLS 指纹与 cookie 处理，几乎不触发 WAF，可稳定拿到数据。
 *
 * 适用 / 不适用：
 *  - 本地开发机有系统 Chrome（puppeteer-core）时生效，覆盖"SSR 被 WAF + a_bogus 被封"的死局；
 *  - Vercel 等无 Chrome 环境：acquirePage 返回 null，自动跳过，不会破坏构建。
 *
 * 本模块复用 browser-pool 的共享浏览器（不再各自冷启动 Chrome），并采用与
 * live-photo-resolver 同源的健壮 fiber 遍历（祖先节点查找 + memoizedProps/memoizedState
 * + null 守卫 + 轮询等待），避免旧实现直接 Object.keys(seed) 在导航中节点 detach 时
 * 抛 "Cannot convert undefined or null to object"。
 *
 * 注意：page.evaluate 的回调会被序列化后发往浏览器执行，不能引用模块作用域的
 * 变量 / 函数 / import，所有 DOM 读取逻辑必须内联在回调内部。
 */
import { logger } from "./logger";
import { acquirePage, releasePage, navigateAndWait, DESKTOP_UA } from "./browser-pool";
import {
  extractRouterData,
  findItemInRouterData,
  findItemInApiJson,
  MOBILE_UA,
} from "./parser/extract";

/**
 * 在浏览器上下文内读取 window._ROUTER_DATA（优先），缺失时回退扫描内联 <script>。
 * 必须保持自包含——仅使用 window / document / JSON 等浏览器全局，不得引用外部作用域。
 *
 * 健壮性：所有属性访问带 try/catch，避免跨域 iframe / 已销毁 context 抛异常。
 */
function readRouterDataInPage(): string | null {
  try {
    const w = window as unknown as Record<string, unknown>;
    const rd = w._ROUTER_DATA;
    if (rd) {
      try {
        return JSON.stringify(rd);
      } catch {
        /* 序列化失败则尝试下方脚本扫描 */
      }
    }
    const scripts = Array.from(document.querySelectorAll("script"));
    for (const s of scripts) {
      const txt = s.textContent || "";
      const idx = txt.indexOf("_ROUTER_DATA");
      if (idx < 0) continue;
      // 深度括号匹配，正确处理超大嵌套 JSON（比惰性正则稳健）
      const eq = txt.indexOf("=", idx);
      if (eq < 0) continue;
      const brace = txt.indexOf("{", eq);
      if (brace < 0) continue;
      let depth = 0;
      for (let i = brace; i < txt.length; i++) {
        const ch = txt[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) return txt.slice(brace, i + 1);
        }
      }
    }
  } catch {
    /* evaluate 期间页面导航/卸载时可能抛错，直接返回 null */
  }
  return null;
}

/**
 * 在浏览器上下文内遍历 React fiber 树，尝试找到完整 aweme item。
 * 抖音桌面端 hydration 后，大量数据通过 fiber 传递，_ROUTER_DATA 可能不完整或缺失。
 *
 * 判定：对象含 desc + author + (music|statistics|video|images) 即可视为 item；
 * 若存在多个候选，优先匹配 aweme_id / awemeId === targetId。
 *
 * 健壮性（修复旧实现"Cannot convert undefined or null to object"与跨域 SecurityError）：
 *  - getFiber 向上遍历祖先节点查找 __reactFiber，避免 seed 节点未直接挂 fiber 时直接返回 null；
 *  - 遍历 memoizedProps + memoizedState + child/sibling/return，覆盖 state 中的数据；
 *  - 全程 null / 类型 / 跨域守卫：所有属性访问走 safeGet；遇到 Window/Node/Location/History/
 *    函数等危险对象直接跳过，避免读取跨域 iframe 或 DOM getter 触发 SecurityError；
 *  - 外层 try/catch：即使 evaluate 期间发生不可预期异常，也返回 null 而不是中断调用方。
 */
function extractItemFromFiberInPage(targetId: string): Record<string, unknown> | null {
  try {
    function getFiber(el: Element | null): Record<string, unknown> | null {
      if (!el) return null;
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
      return key
        ? ((el as unknown as Record<string, unknown>)[key] as Record<string, unknown>)
        : null;
    }

    // 安全读取对象属性，避免跨域 iframe / DOM getter / Illegal invocation
    function safeGet<T>(obj: unknown, key: string): T | undefined {
      try {
        if (!obj || typeof obj !== "object") return undefined;
        return (obj as Record<string, unknown>)[key] as T;
      } catch {
        return undefined;
      }
    }

    function safeKeys(obj: unknown): string[] {
      try {
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
        return Object.keys(obj);
      } catch {
        return [];
      }
    }

    // 识别并跳过危险对象：DOM 节点、Window、Location、History、函数、跨域对象
    function isUnsafe(o: unknown): boolean {
      if (o == null) return true;
      if (typeof o === "function") return true;
      if (typeof o !== "object") return false;
      try {
        // DOM / Window / Location / History 检测
        if (typeof (o as Record<string, unknown>).nodeType === "number") return true;
        const winLike =
          (o as Record<string, unknown>).self === o && (o as Record<string, unknown>).window === o;
        if (winLike) return true;
        if (o instanceof Window) return true;
        if (o instanceof Node) return true;
        if (o instanceof Location) return true;
        if (o instanceof History) return true;
      } catch {
        // 访问 iframe 里的对象时 instanceof 可能抛 SecurityError，直接视为不安全
        return true;
      }
      return false;
    }

    const seedEl: Element | null =
      document.querySelector(".dySwiperSlide") ||
      document.querySelector(".note-detail-container") ||
      document.querySelector("video") ||
      document.body;
    let start = getFiber(seedEl);
    if (!start) {
      // 向上遍历 DOM 树，找到首个带 fiber 的祖先节点
      let e: Element | null = document.body;
      while (e && !start) {
        start = getFiber(e);
        e = e.firstElementChild;
      }
    }
    if (!start) return null;

    const isItemLike = (o: unknown): boolean => {
      if (!o || typeof o !== "object" || isUnsafe(o)) return false;
      try {
        const obj = o as Record<string, unknown>;
        const hasDesc = typeof safeGet<string>(obj, "desc") === "string";
        const author = safeGet<unknown>(obj, "author");
        const music = safeGet<unknown>(obj, "music");
        const statistics = safeGet<unknown>(obj, "statistics");
        const video = safeGet<unknown>(obj, "video");
        const images = safeGet<unknown[]>(obj, "images");
        const hasAuthor = !!author && typeof author === "object" && !isUnsafe(author);
        const hasMusic = !!music && typeof music === "object" && !isUnsafe(music);
        const hasStats = !!statistics && typeof statistics === "object" && !isUnsafe(statistics);
        const hasVideo = !!video && typeof video === "object" && !isUnsafe(video);
        const hasImages = Array.isArray(images);
        return hasDesc && hasAuthor && (hasMusic || hasStats || hasVideo || hasImages);
      } catch {
        return false;
      }
    };
    const getId = (o: unknown): string | undefined => {
      if (!o || typeof o !== "object" || isUnsafe(o)) return undefined;
      try {
        const obj = o as Record<string, unknown>;
        const id =
          safeGet(obj, "aweme_id") ?? safeGet(obj, "awemeId") ?? safeGet(obj, "awemeIdList");
        return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
      } catch {
        return undefined;
      }
    };

    const visited = new Set<unknown>();
    const stack: unknown[] = [start];
    let bestMatch: Record<string, unknown> | null = null;
    let n = 0;

    // 遍历上限：slides（混合图文）fiber 树较深，原 60k 可能在抵达 item 前就终止，
    // 提高到 200k 与 live-photo-resolver 保持一致。
    while (stack.length && n < 200000) {
      const f = stack.pop() as Record<string, unknown> | undefined;
      n++;
      if (!f || typeof f !== "object" || visited.has(f)) continue;
      visited.add(f);

      const subjects: unknown[] = [];
      const props = safeGet<Record<string, unknown>>(f, "memoizedProps");
      const state = safeGet<Record<string, unknown>>(f, "memoizedState");
      if (props && typeof props === "object" && !isUnsafe(props)) subjects.push(props);
      if (state && typeof state === "object" && !isUnsafe(state)) subjects.push(state);

      for (const subj of subjects) {
        const queue: unknown[] = [subj];
        const seen = new Set<unknown>();
        let m = 0;
        while (queue.length && m < 8000) {
          m++;
          const cur = queue.shift();
          if (!cur || typeof cur !== "object" || seen.has(cur) || isUnsafe(cur)) continue;
          seen.add(cur);
          if (isItemLike(cur)) {
            if (getId(cur) === targetId) return cur as Record<string, unknown>;
            if (!bestMatch) bestMatch = cur as Record<string, unknown>;
          }
          if (Array.isArray(cur)) {
            for (const item of cur) queue.push(item);
          } else {
            for (const k of safeKeys(cur)) {
              if (k.startsWith("__react")) continue;
              queue.push(safeGet(cur, k));
            }
          }
        }
      }

      const child = safeGet(f, "child");
      const sibling = safeGet(f, "sibling");
      const ret = safeGet(f, "return");
      if (child) stack.push(child);
      if (sibling) stack.push(sibling);
      if (ret) stack.push(ret);
    }
    return bestMatch;
  } catch {
    // evaluate 期间页面导航/卸载/跨域访问等不可控异常，统一返回 null，
    // 让调用方继续下一候选或最终 400，而不是抛未处理异常。
    return null;
  }
}

function isWafResponse(html: string): boolean {
  const marker = html.slice(0, 6000).toLowerCase();
  return (
    marker.includes("waf_js") ||
    marker.includes("wafchallengeid") ||
    marker.includes("argus-csp-token") ||
    marker.includes("/waf-jschallenge/")
  );
}

/**
 * 通过无头浏览器获取完整 aweme item（含 video / images / author / music / statistics）。
 * 复用 browser-pool 的常驻共享浏览器（warm 复用，不再冷启动）。
 *
 * 候选策略（按可靠性排序）：
 *  1. www.iesdouyin.com/share/{note|video}/{id}/ + 移动端 UA：
 *     抖音 SSR 分享页会把完整 aweme 直接嵌进 HTML 的 window._ROUTER_DATA，
 *     真实 Chrome 的 TLS 指纹通常能绕过 iesdouyin 对裸 Node fetch 的 WAF。
 *  2. www.douyin.com/note|video/{id} + 桌面端 UA：
 *     如果 iesdouyin 被拦截或重定向异常，回退桌面端；优先读 hydration 后的
 *     _ROUTER_DATA，未命中则遍历 React fiber 兜底。
 *
 * 关键修复（针对用户日志中的 400）：
 *  - 优先从 page.goto 返回的初始 response body 提取 _ROUTER_DATA，避免 SPA 客户端
 *    重定向导致 evaluate 时 "Execution context was destroyed"；
 *  - 对桌面端用 navigateAndWait 等待 hydration，避免数据未挂载就读取；
 *  - fiber 遍历增加 safeGet / isUnsafe 守卫，避免访问跨域 iframe / DOM getter 触发
 *    SecurityError / Illegal invocation。
 *
 * @returns item 对象，或 null（无 Chrome / 导航失败 / 未找到 item）
 */
export async function loadRouterDataViaBrowser(
  awemeId: string
): Promise<Record<string, unknown> | null> {
  const page = await acquirePage();
  if (!page) {
    logger.warn("aweme-detail", "未获取到浏览器 page（无 Chrome / 池不可用），跳过浏览器兜底");
    return null;
  }

  // 候选顺序：iesdouyin 移动端分享页优先（SSR 数据更全），桌面端 fiber 兜底。
  const candidates: { url: string; ua: "mobile" | "desktop" }[] = [
    { url: `https://www.iesdouyin.com/share/note/${awemeId}/`, ua: "mobile" },
    { url: `https://www.iesdouyin.com/share/video/${awemeId}/`, ua: "mobile" },
    { url: `https://www.douyin.com/note/${awemeId}`, ua: "desktop" },
    { url: `https://www.douyin.com/video/${awemeId}`, ua: "desktop" },
  ];

  // 收集导航期间抖音内部 API 的 JSON 响应（aweme 详情等）。
  // 直接拦截响应体比遍历 React fiber 树更稳健——抖音现已不再 SSR 内嵌
  // item_list，而是页面加载后用真实浏览器签名拉取内部 API（如
  // /aweme/v1/web/aweme/detail/），该响应即完整 aweme item 来源。
  const captured: { url: string; body: string }[] = [];
  const onResponse = (resp: import("puppeteer-core").HTTPResponse) => {
    const u = resp.url();
    const ct = resp.headers()["content-type"] || "";
    if (ct.includes("json") || /aweme|detail|item/.test(u)) {
      resp
        .text()
        .then((body) => {
          if (
            body &&
            (body.includes("aweme_detail") ||
              body.includes("aweme_id") ||
              body.includes("item_list"))
          ) {
            captured.push({ url: u, body });
          }
        })
        .catch(() => {});
    }
  };
  page.on("response", onResponse);

  try {
    for (const { url, ua } of candidates) {
      captured.length = 0;
      // 根据目标域名设置对应 UA：iesdouyin 用移动端 UA 才能拿到 SSR 内嵌数据
      try {
        await page.setUserAgent(ua === "mobile" ? MOBILE_UA : DESKTOP_UA);
      } catch (uaErr) {
        logger.warn("aweme-detail", `设置 UA 失败 ${url}:`, (uaErr as Error)?.message ?? uaErr);
      }

      // 导航，保留 response 以便从初始 HTML 提取 _ROUTER_DATA
      let response: import("puppeteer-core").HTTPResponse | null = null;
      try {
        response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      } catch (gotoErr) {
        logger.warn("aweme-detail", `导航未完成 ${url}:`, (gotoErr as Error)?.message ?? gotoErr);
        continue;
      }

      // 1) 优先从初始 response body 提取（不受后续 SPA 导航 / context 销毁影响）
      if (response) {
        try {
          const html = await response.text();
          if (isWafResponse(html)) {
            logger.warn("aweme-detail", `浏览器兜底遇 WAF 挑战页 ${url}`);
          } else {
            const rd = extractRouterData(html);
            if (rd) {
              const item = findItemInRouterData(rd);
              if (item) {
                logger.info("aweme-detail", `浏览器兜底命中(response _ROUTER_DATA) ${url}`);
                return item;
              }
              logger.warn("aweme-detail", `浏览器兜底 response _ROUTER_DATA 未解析出 item ${url}`);
            } else {
              logger.warn("aweme-detail", `浏览器兜底 response 无 _ROUTER_DATA ${url}`);
            }
          }
        } catch (bodyErr) {
          logger.warn(
            "aweme-detail",
            `读取 response body 异常 ${url}:`,
            (bodyErr as Error)?.message ?? bodyErr
          );
        }
      }

      // 2) 等待 hydration / SPA 导航稳定
      if (ua === "desktop") {
        await navigateAndWait(page, url, 15000);
      } else {
        // 移动端分享页：给 _ROUTER_DATA 脚本一点时间解析到 window
        await new Promise((r) => setTimeout(r, 800));
        try {
          await page.waitForFunction(() => document.readyState === "complete", { timeout: 5000 });
        } catch {
          /* 超时继续 */
        }
      }

      // 3) 网络拦截优先：直接抓抖音内部 API 返回的 aweme 详情 JSON（最稳健路径）。
      //    必须等 hydration / SPA 拉取完成后再扫描，此时 API 响应才已到达；
      //    同时留出时间让在途的 resp.text() Promise 落盘，避免漏扫刚到达的响应。
      await new Promise((r) => setTimeout(r, 600));
      for (const c of captured) {
        const item = findItemInApiJson(c.body, awemeId);
        if (item) {
          logger.info("aweme-detail", `浏览器兜底命中(网络拦截) ${c.url}`);
          return item;
        }
      }
      if (captured.length) {
        const urls = captured.map((c) => c.url).join(" | ");
        logger.warn(
          "aweme-detail",
          `浏览器兜底网络拦截到 ${captured.length} 个响应，但未解析出 item ${url}；响应URL: ${urls}`
        );
      }

      // 4) 尝试读取当前 window._ROUTER_DATA / 内联 script
      let rd: string | null = null;
      try {
        rd = await page.evaluate(readRouterDataInPage);
      } catch (evalErr) {
        logger.warn(
          "aweme-detail",
          `读取 _ROUTER_DATA 异常 ${url}（尝试 fiber 兜底）:`,
          (evalErr as Error)?.message ?? evalErr
        );
      }

      if (rd) {
        const item = findItemInRouterData(rd);
        if (item) {
          logger.info("aweme-detail", `浏览器兜底命中(_ROUTER_DATA) ${url}`);
          return item;
        }
        logger.warn("aweme-detail", `浏览器兜底读取到 _ROUTER_DATA 但未解析出 item ${url}`);
      }

      // 5) _ROUTER_DATA 未命中：遍历 fiber 兜底（桌面端 SPA 数据可能只在 fiber 中）
      try {
        const fiberItem = await page.evaluate(extractItemFromFiberInPage, awemeId);
        if (fiberItem) {
          logger.info("aweme-detail", `浏览器兜底命中(fiber) ${url}`);
          return fiberItem;
        }
      } catch (fiberErr) {
        logger.warn(
          "aweme-detail",
          `fiber 兜底异常 ${url}（尝试下一候选）:`,
          (fiberErr as Error)?.message ?? fiberErr
        );
        // 导航中途 context 销毁时继续下一候选
        continue;
      }

      logger.warn("aweme-detail", `浏览器兜底当前候选未命中 ${url}`);
    }

    logger.warn("aweme-detail", "浏览器兜底未找到 item");
    return null;
  } finally {
    page.off("response", onResponse);
    await releasePage(page);
  }
}
