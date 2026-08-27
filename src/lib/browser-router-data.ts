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
import { getBrowserCreds, harvestBrowserCreds } from "./credentials-cache";

/**
 * 启动期凭证预热的种子视频 ID。
 *
 * 预热逻辑会导航到 `douyin.com/video/<seed>` 并等待其发出被服务端接受的 aweme/detail
 * 请求，从而实时收割整组自洽凭证（webid/verifyFp/fp/msToken + cookie 里的 ttwid/odin_tt）。
 * 该 ID 取自在当前环境实测可用的真实公开视频；若被删除导致预热失败，首请求会优雅回退到
 * 浏览器兜底（与现状一致，无回归）。可用环境变量 PREWARM_AWEME_ID 覆盖。
 */
const DEFAULT_PREWARM_ID = "7677900763570095817";

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
 * 按链接类型构造浏览器兜底候选顺序（见 loadRouterDataViaBrowser 注释中的排序策略）。
 */
function buildCandidates(
  awemeId: string,
  type?: "video" | "note" | "slides"
): { url: string; ua: "mobile" | "desktop" }[] {
  const iesNote = `https://www.iesdouyin.com/share/note/${awemeId}/`;
  const iesVideo = `https://www.iesdouyin.com/share/video/${awemeId}/`;
  const douyinNote = `https://www.douyin.com/note/${awemeId}`;
  const douyinVideo = `https://www.douyin.com/video/${awemeId}`;

  if (type === "video") {
    return [
      { url: douyinVideo, ua: "desktop" },
      { url: iesVideo, ua: "mobile" },
      { url: douyinNote, ua: "desktop" },
      { url: iesNote, ua: "mobile" },
    ];
  }
  if (type === "note") {
    // 图文帖在本环境 iesdouyin 已被 WAF，且 douyin.com/note 不触发 aweme/detail；
    // 实测 douyin.com/video/{id} 仍会发出被服务端接受的 aweme/detail 请求并带回完整 item
    // （含 images），故把该候选提前到首位，浏览器兜底可从 ~13s 降到 ~4s。
    return [
      { url: douyinVideo, ua: "desktop" },
      { url: iesNote, ua: "mobile" },
      { url: douyinNote, ua: "desktop" },
      { url: iesVideo, ua: "mobile" },
    ];
  }
  // 默认（未知类型 / slides）：douyin.com/video 稳定触发 aweme/detail 拦截，放首位。
  return [
    { url: douyinVideo, ua: "desktop" },
    { url: iesNote, ua: "mobile" },
    { url: iesVideo, ua: "mobile" },
    { url: douyinNote, ua: "desktop" },
  ];
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
  awemeId: string,
  opts?: { type?: "video" | "note" | "slides" }
): Promise<Record<string, unknown> | null> {
  const page = await acquirePage();
  if (!page) {
    logger.warn("aweme-detail", "未获取到浏览器 page（无 Chrome / 池不可用），跳过浏览器兜底");
    return null;
  }

  // 候选顺序按链接类型自适应，减少无谓试错：
  //  - video：优先 douyin.com/video（稳定拦截 aweme/detail 提前返回 ~1.2s），
  //          再 iesdouyin/video（可能被 WAF，快跳过），最后两类 note 兜底；
  //  - note ：优先 iesdouyin/note（SSR 最快），再 douyin.com/note（fiber 兜底），
  //          最后两类 video 兜底；
  //  - 未知/默认：保持原 note 优先顺序，避免回归。
  // 视频链接若先试 note 候选，会因 note 页无 aweme/detail 白耗数秒（最差路径 14s+ 即此）。
  const candidates: { url: string; ua: "mobile" | "desktop" }[] = buildCandidates(
    awemeId,
    opts?.type
  );

  // 收集导航期间抖音内部 API 的 JSON 响应（aweme 详情等）。
  // 直接拦截响应体比遍历 React fiber 树更稳健——抖音现已不再 SSR 内嵌
  // item_list，而是页面加载后用真实浏览器签名拉取内部 API（如
  // /aweme/v1/web/aweme/detail/），该响应即完整 aweme item 来源。
  //
  // 注意：必须过滤掉相关推荐/搜索/feed 等列表接口（如 image/related、search、
  // feed、recommend），它们的 list[0] 不是目标作品，findItemInApiJson 按 awemeId
  // 匹配也会失败，不能作为兜底数据源。
  const captured: { url: string; body: string }[] = [];
  let capturedResolve: ((value: { item: Record<string, unknown>; url: string }) => void) | null =
    null;
  const makeCapturePromise = () =>
    new Promise<{ item: Record<string, unknown>; url: string }>((resolve) => {
      capturedResolve = resolve;
    });
  const noisePattern =
    /\/(?:search|feed|recommend|related|hot|discover|suggest|rank|list\/general)\//i;
  const onResponse = (resp: import("puppeteer-core").HTTPResponse) => {
    const u = resp.url();
    const ct = resp.headers()["content-type"] || "";
    if (noisePattern.test(u)) return; // 排除推荐/搜索等噪声接口
    // 收割浏览器会话凭证：aweme/detail 这条「服务端已接受的请求」其 URL 携带
    // 自洽的 msToken/webid/verifyFp/fp，配合页面 cookie 里的 ttwid/odin_tt，
    // 正是 a_bogus Node 直连所需的完整同源凭证集。实时收割后供 /api/parse 后续
    // 请求走更快的 a_bogus 路径（绕过浏览器冷启动）。
    if (/aweme\/v1\/web\/aweme\/detail/.test(u)) {
      try {
        const req = resp.request();
        const reqUrl = req.url();
        const parsed = new URL(reqUrl);
        const msToken = parsed.searchParams.get("msToken") ?? undefined;
        const webid = parsed.searchParams.get("webid") ?? undefined;
        const verifyFp = parsed.searchParams.get("verifyFp") ?? undefined;
        const fp = parsed.searchParams.get("fp") ?? undefined;
        page
          .cookies("https://www.douyin.com")
          .then((cs) => {
            const ttwid = cs.find((c) => c.name === "ttwid")?.value;
            const odin_tt = cs.find((c) => c.name === "odin_tt")?.value;
            // 抖音 aweme/detail 请求的 msToken 常不在 query（webmssdk 写入 cookie），
            // 故优先用 query 里的，缺失时回退 cookie 里的 msToken，确保桥接凭证完整。
            const msTokenCookie = cs.find((c) => c.name === "msToken")?.value;
            harvestBrowserCreds({
              ttwid: ttwid ? `ttwid=${ttwid}` : undefined,
              odin_tt: odin_tt ? `odin_tt=${odin_tt}` : undefined,
              msToken: msToken || (msTokenCookie ? msTokenCookie : undefined),
              webid,
              verifyFp,
              fp,
            });
          })
          .catch(() => {});
      } catch {
        /* 收割失败不阻断主流程 */
      }
    }
    if (ct.includes("json") || /aweme|detail|item|post/.test(u)) {
      resp
        .text()
        .then((body) => {
          if (
            body &&
            (body.includes("aweme_detail") ||
              body.includes("aweme_id") ||
              body.includes("item_list") ||
              body.includes("aweme_list"))
          ) {
            captured.push({ url: u, body });
            // 响应驱动：一旦命中目标作品立即结束当前候选，不必等满 hydration 超时。
            const item = findItemInApiJson(body, awemeId);
            if (item && capturedResolve) {
              const resolve = capturedResolve;
              capturedResolve = null;
              resolve({ item, url: u });
            }
          }
        })
        .catch(() => {});
    }
  };
  page.on("response", onResponse);

  try {
    for (const { url, ua } of candidates) {
      captured.length = 0;
      const capturePromise = makeCapturePromise();
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
            // WAF 挑战页不会发出有效 API，直接跳到下一候选，
            // 省去后续 hydration / fiber 等待（实测可省数秒）。
            logger.warn("aweme-detail", `浏览器兜底遇 WAF 挑战页 ${url}，跳过该候选`);
            continue;
          }
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
        } catch (bodyErr) {
          logger.warn(
            "aweme-detail",
            `读取 response body 异常 ${url}:`,
            (bodyErr as Error)?.message ?? bodyErr
          );
        }
      }

      // 2) 等待 hydration / SPA 导航稳定，同时响应驱动：若拦截到目标 API 立即返回。
      //    抖音 aweme/detail 等内部 API 通常在 hydration 途中就已发出，不必等满
      //    navigateAndWait 的 selector/_ROUTER_DATA 轮询，可节省数秒。
      const hydrationWait = (async () => {
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
        return null as { item: Record<string, unknown>; url: string } | null;
      })();

      const early = await Promise.race([capturePromise, hydrationWait]);
      if (early) {
        const { item, url: hitUrl } = early;
        const images = item.images as unknown[] | undefined;
        const author = item.author as Record<string, unknown> | undefined;
        logger.info(
          "aweme-detail",
          `浏览器兜底命中(网络拦截-提前返回) ${hitUrl} ` +
            `aweme_id=${item.aweme_id} ` +
            `desc=${String(item.desc ?? "").slice(0, 30)} ` +
            `images=${Array.isArray(images) ? images.length : 0} ` +
            `author=${author ? String(author.nickname ?? author.uid ?? "?") : "missing"}`
        );
        return item;
      }

      // 3) 网络拦截优先：直接抓抖音内部 API 返回的 aweme 详情 JSON（最稳健路径）。
      //    必须等 hydration / SPA 拉取完成后再扫描，此时 API 响应才已到达；
      //    同时留出时间让在途的 resp.text() Promise 落盘，避免漏扫刚到达的响应。
      await new Promise((r) => setTimeout(r, 600));
      for (const c of captured) {
        const item = findItemInApiJson(c.body, awemeId);
        if (item) {
          const images = item.images as unknown[] | undefined;
          const author = item.author as Record<string, unknown> | undefined;
          logger.info(
            "aweme-detail",
            `浏览器兜底命中(网络拦截) ${c.url} ` +
              `aweme_id=${item.aweme_id} ` +
              `desc=${String(item.desc ?? "").slice(0, 30)} ` +
              `images=${Array.isArray(images) ? images.length : 0} ` +
              `author=${author ? String(author.nickname ?? author.uid ?? "?") : "missing"}`
          );
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

      // fiber 遍历可能耗时较久，期间目标 aweme/detail 响应才到达；
      // 最终再扫一次已捕获响应，兜住这一种边界，避免已拿到却漏返。
      for (const c of captured) {
        const item = findItemInApiJson(c.body, awemeId);
        if (item) {
          const images = item.images as unknown[] | undefined;
          const author = item.author as Record<string, unknown> | undefined;
          logger.info(
            "aweme-detail",
            `浏览器兜底命中(网络拦截-延迟) ${c.url} ` +
              `aweme_id=${item.aweme_id} ` +
              `desc=${String(item.desc ?? "").slice(0, 30)} ` +
              `images=${Array.isArray(images) ? images.length : 0} ` +
              `author=${author ? String(author.nickname ?? author.uid ?? "?") : "missing"}`
          );
          return item;
        }
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

/**
 * 启动期预收割浏览器会话凭证（消除首条解析请求的浏览器兜底成本）。
 *
 * 首条 /api/parse 之所以慢，是因为 a_bogus 在浏览器兜底「实时收割到自洽凭证」之前
 * 没有任何可用凭证，只能走 ~13s 的无头浏览器兜底；而浏览器兜底一旦命中就会把
 * 整组同源凭证（webid/verifyFp/fp/msToken + cookie 的 ttwid/odin_tt）写入缓存，
 * 后续 a_bogus 即可直接命中（~1s）。本函数在服务启动后抢先跑一次浏览器，把凭证预热好，
 * 让用户的「第一条」请求也走快的 a_bogus，而非每次冷启动都先付浏览器代价。
 *
 * 行为：
 *  - 非阻塞、best-effort：仅在未禁用浏览器兜底时执行；
 *  - 复用共享浏览器（acquirePage 内部会拉起 warm 浏览器），导航到 douyin.com/video/{seed}，
 *    挂 response 监听实时收割 aweme/detail 请求里的凭证，轮询至拿到或超时；
 *  - 种子来自 PREWARM_AWEME_ID 或内置 DEFAULT_PREWARM_ID；若不可用（无 Chrome / 种子失效），
 *    静默跳过，等价于当前行为，无回归；
 *  - 已热（缓存非空）则直接返回，避免重复预热。
 */
/** 启动期预热带的 Promise（用于首请求判断"是否仍在进行"）。null 表示未进行。 */
let prewarmPromise: Promise<void> | null = null;

/**
 * 启动期预收割浏览器会话凭证（消除首条解析请求的浏览器兜底成本）。
 *
 * 首条 /api/parse 之所以慢，是因为 a_bogus 在浏览器兜底「实时收割到自洽凭证」之前
 * 没有任何可用凭证，只能走 ~13s 的无头浏览器兜底；而浏览器兜底一旦命中就会把
 * 整组同源凭证（webid/verifyFp/fp/msToken + cookie 的 ttwid/odin_tt）写入缓存，
 * 后续 a_bogus 即可直接命中（~1s）。本函数在服务启动后抢先跑一次浏览器，把凭证预热好，
 * 让用户的「第一条」请求也走快的 a_bogus，而非每次冷启动都先付浏览器代价。
 *
 * 行为：
 *  - 非阻塞、best-effort：仅在未禁用浏览器兜底时执行；
 *  - 幂等：同一进程只预热一次（instrumentation 即便多次调用也复用同一 Promise），
 *    完成后将 prewarmPromise 置空，允许凭证过期后按需重新预热（无需重启服务）；
 *  - 复用共享浏览器（acquirePage 内部会拉起 warm 浏览器），导航到 douyin.com/video/{seed}，
 *    挂 response 监听实时收割 aweme/detail 请求里的凭证，轮询至拿到或超时；
 *  - 种子来自 PREWARM_AWEME_ID 或内置 DEFAULT_PREWARM_ID；若不可用（无 Chrome / 种子失效），
 *    静默跳过，等价于当前行为，无回归；
 *  - 已热（缓存非空）则直接返回，避免重复预热。
 */
export function prewarmBrowserCreds(): Promise<void> {
  if (process.env.DISABLE_BROWSER_FALLBACK === "true") return Promise.resolve();
  // 幂等：避免 instrumentation 在不同生命周期（dev 热重载等）重复拉起预热。
  if (prewarmPromise) return prewarmPromise;

  const p = (async () => {
    if (getBrowserCreds()) return; // 已热，无需预热

    const seed = (process.env.PREWARM_AWEME_ID || DEFAULT_PREWARM_ID).trim();
    if (!seed) return;

    const page = await acquirePage();
    if (!page) {
      logger.warn("aweme-detail", "预热未获取到浏览器 page（无 Chrome / 池不可用），跳过");
      return;
    }

    const onResp = (resp: import("puppeteer-core").HTTPResponse) => {
      const u = resp.url();
      if (!/aweme\/v1\/web\/aweme\/detail/.test(u)) return;
      try {
        const req = resp.request();
        const parsed = new URL(req.url());
        const msToken = parsed.searchParams.get("msToken") ?? undefined;
        const webid = parsed.searchParams.get("webid") ?? undefined;
        const verifyFp = parsed.searchParams.get("verifyFp") ?? undefined;
        const fp = parsed.searchParams.get("fp") ?? undefined;
        page
          .cookies("https://www.douyin.com")
          .then((cs) => {
            const ttwid = cs.find((c) => c.name === "ttwid")?.value;
            const odin_tt = cs.find((c) => c.name === "odin_tt")?.value;
            harvestBrowserCreds({
              ttwid: ttwid ? `ttwid=${ttwid}` : undefined,
              odin_tt: odin_tt ? `odin_tt=${odin_tt}` : undefined,
              msToken,
              webid,
              verifyFp,
              fp,
            });
          })
          .catch(() => {});
      } catch {
        /* 收割失败不阻断 */
      }
    };

    try {
      await page.setUserAgent(DESKTOP_UA);
      page.on("response", onResp);
      try {
        await page.goto(`https://www.douyin.com/video/${seed}`, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
      } catch (gotoErr) {
        logger.warn("aweme-detail", `预热导航未完成:`, (gotoErr as Error)?.message ?? gotoErr);
      }
      // 轮询等待凭证收割：aweme/detail 通常在 hydration 途中发出，给足时间但设上限。
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && !getBrowserCreds()) {
        await new Promise((r) => setTimeout(r, 500));
      }
      if (getBrowserCreds()) {
        logger.info("aweme-detail", "凭证预热完成（启动期收割），首请求将走 a_bogus 桥接");
      } else {
        logger.warn("aweme-detail", "凭证预热未拿到（种子可能失效），首请求回退浏览器兜底");
      }
    } finally {
      page.off("response", onResp);
      await releasePage(page);
    }
  })();

  prewarmPromise = p;
  // 完成后置空，允许凭证过期后按需重新预热（无需重启服务）。
  p.finally(() => {
    prewarmPromise = null;
  }).catch(() => {});
  return p;
}

/** 预热带是否仍在进行（首请求据此决定是否短暂等待，而非并行启动更贵的浏览器兜底） */
export function isPrewarmPending(): boolean {
  return prewarmPromise !== null;
}

/** 等待预热带完成（带超时上限）。超时或预热失败均不抛错，交由调用方继续原兜底路径。 */
export async function awaitPrewarm(timeoutMs: number): Promise<void> {
  const p = prewarmPromise;
  if (!p) return;
  try {
    await Promise.race([p, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
  } catch {
    /* 预热失败不影响主流程 */
  }
}
