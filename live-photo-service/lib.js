// 抖音实况照片解析服务核心库（零依赖，仅用 Node 内置模块）。
//
// 设计要点：
//  - a_bogus 生成：内联 ylcangel/douyin_sign 的 SM3 + CORE 源码，在 node:vm 沙箱中
//    以"假浏览器环境"执行（递归 Proxy 提供 navigator/window），无需任何浏览器。
//  - 数据来源：aweme/v1/web/aweme/detail（需要 a_bogus 签名）。本服务部署在**国内 IP**，
//    因此能正常拿到响应（海外 IP 会被抖音地理封锁返回空响应，见 Vercel 诊断结论）。
//  - 解析：从 aweme_detail 的 image_post_info.images / images 中提取实况照片的
//    静态原图与 douyinvod 动态短片 URL，输出与前端一致的 ResolvedLivePhoto[]。
//
// 本文件无副作用（不启动 HTTP 服务），便于单元测试直接 import。

import vm from "node:vm";
import crypto from "node:crypto";
import { SM3_SRC, CORE_SRC } from "./abogus-vendor.js";

const PC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 递归 Proxy：为 a_bogus 提供"假浏览器环境"，未定义属性统一降级为 0 / "" / 自身，
// 避免 Node 端缺失 navigator/screen 等对象导致算法崩溃（与前端 abogus/index.ts 同源）。
function createBrowserSandbox(userAgent) {
  const target = function () {};
  const box = {};
  const handler = {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === "toString") return () => "";
      if (p === "valueOf") return () => 0;
      if (p === "length") return 0;
      if (p in t) return t[p];
      return box.proxy;
    },
    set(t, p, v) {
      t[p] = v;
      return true;
    },
    has() {
      return true;
    },
    apply() {
      return box.proxy;
    },
  };
  box.proxy = new Proxy(target, handler);
  box.proxy.userAgent = userAgent;
  box.proxy.vendorSubs = {};
  return box.proxy;
}

function getSandbox() {
  // 注意：每次生成都使用全新沙箱。a_bogus 核心脚本（如 U 数组、程序计数器）会在
  // 执行 makeABogus 时改写自身全局状态；若复用沙箱，第二次生成的签名会因状态污染
  // 而出现非法字符甚至完全错误。vm 初始化 36KB 源码耗时 <1ms，性能可忽略，正确性优先。
  const navigator = createBrowserSandbox(PC_UA);
  const window = createBrowserSandbox(PC_UA);
  const ctx = {
    console,
    navigator,
    window,
    performance: { now: () => Date.now() },
    Date,
    Math,
    JSON,
    String,
    Array,
    Object,
    Number,
    Boolean,
    RegExp,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SM3_SRC, ctx, { filename: "sm3.js" });
  vm.runInContext(CORE_SRC, ctx, { filename: "abogus-core.js" });
  return ctx;
}

// 生成 a_bogus 签名。uri 为待签名的查询串（不含 a_bogus 本身）。
export function generateABogus(uri, ts = Date.now()) {
  const ctx = getSandbox();
  const code =
    '(function(){ programVersion="release"; return makeABogus(' +
    JSON.stringify(uri) +
    ", " +
    ts +
    "); })()";
  const result = vm.runInContext(code, ctx, { filename: "call.js" });
  if (typeof result !== "string" || result.length === 0) {
    throw new Error("generateABogus 生成失败，返回 " + JSON.stringify(result));
  }
  return result;
}

// 合成 ttwid cookie：抖音对 ttwid 校验宽松，首页 bootstrap 失败时用它兜底。
export function generateSyntheticTtwid() {
  const rand = crypto.randomBytes(20).toString("base64").replace(/=+$/, "");
  return "ttwid=1|" + rand;
}

// 访问抖音首页获取真实 ttwid（国内 IP 通常可拿到）；失败回退合成 ttwid。
export async function fetchTtwid() {
  try {
    const res = await fetch("https://www.douyin.com/", {
      headers: { "user-agent": PC_UA, accept: "text/html" },
      redirect: "follow",
    });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    const ttwidCookie = setCookies.find((c) => c.startsWith("ttwid="));
    if (ttwidCookie) return ttwidCookie.split(";")[0];
  } catch {
    /* 忽略，走合成兜底 */
  }
  return generateSyntheticTtwid();
}

// 为 aweme/detail 构造带 a_bogus 签名的请求。
export async function signAwemeDetail(awemeId) {
  const ts = Date.now();
  const query =
    "aid=6383&device_platform=webapp&channel=channel_pc_web&webid=local-" +
    "&aweme_id=" +
    awemeId +
    "&cursor=0&count=1&publish_video_strategy_type=2&pc_client_type=1";
  const aBogus = generateABogus(query, ts);
  const ttwid = await fetchTtwid();
  const url =
    "https://www.douyin.com/aweme/v1/web/aweme/detail/?" +
    query +
    "&a_bogus=" +
    encodeURIComponent(aBogus);
  const headers = {
    "user-agent": PC_UA,
    referer: "https://www.douyin.com/",
    accept: "application/json",
  };
  if (ttwid) headers.cookie = ttwid;
  return { url, headers, aBogus, ts };
}

/* ------------------------------------------------------------------ */
/* 实况照片解析（从 aweme/detail 响应 JSON 提取）                      */
/* ------------------------------------------------------------------ */

function isLiveImage(im) {
  if (!im || typeof im !== "object") return false;
  return (
    im.clipType === 5 ||
    im.clipType === "5" ||
    im.livePhotoType === 1 ||
    im.livePhotoType === "1" ||
    im.live_photo === true ||
    (typeof im.live_photo === "object" && im.live_photo !== null) ||
    im.livePhoto === true ||
    im.isLivePhoto === true
  );
}

function pickImageUrl(im) {
  const candidates = [];
  if (im.urlList) candidates.push(im.urlList);
  if (im.url_list) candidates.push(im.url_list);
  if (im.imageUrl) candidates.push(im.imageUrl);
  if (im.originUrl) candidates.push(im.originUrl);
  if (im.displayImage) candidates.push(im.displayImage);
  if (im.cover) candidates.push(im.cover);

  const flatten = (src) => {
    if (typeof src === "string") return [src];
    if (Array.isArray(src)) return src.flatMap(flatten);
    if (src && typeof src === "object") {
      const o = src;
      if (typeof o.url === "string") return [o.url];
      if (typeof o.uri === "string") return [o.uri];
      if (Array.isArray(o.url_list)) return o.url_list.flatMap(flatten);
    }
    return [];
  };

  const all = candidates.flatMap(flatten).filter((u) => typeof u === "string" && u.length > 0);
  for (const u of all) if (u.includes("douyinpic")) return u;
  return all[0] || "";
}

function extractVideoUrl(video) {
  if (!video || typeof video !== "object") return "";
  const bitRateList = Array.isArray(video.bitRateList) ? video.bitRateList : [];
  for (const item of bitRateList) {
    if (!item || typeof item !== "object") continue;
    const playAddr = item.playAddr;
    const arr = Array.isArray(playAddr) ? playAddr : [playAddr];
    for (const p of arr) {
      if (!p) continue;
      if (p && typeof p === "object" && typeof p.src === "string" && p.src.includes("douyinvod"))
        return p.src;
      if (typeof p === "string" && p.includes("douyinvod")) return p;
    }
  }
  const playAddr = video.play_addr;
  if (playAddr && typeof playAddr === "object") {
    const u = (playAddr.url_list || []).find(
      (x) => typeof x === "string" && x.includes("douyinvod")
    );
    if (u) return u;
  }
  // 全局兜底扫描 douyinvod（防止字段命名异常导致漏检）
  let found = "";
  const visit = (obj) => {
    if (found || !obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach(visit);
      return;
    }
    for (const k of Object.keys(obj)) {
      const val = obj[k];
      if (typeof val === "string" && val.includes("douyinvod")) {
        found = val;
        return;
      }
      visit(val);
    }
  };
  visit(video);
  return found;
}

/**
 * 从 aweme/detail 的解析后 JSON 提取实况照片，返回 ResolvedLivePhoto[]。
 * 与前端 live-photo-resolver 的扫描逻辑保持同构（index / imageUrl / videoUrl）。
 */
export function parseAwemeDetailLivePhotos(json) {
  const d = json?.aweme_detail;
  if (!d) return [];
  const out = [];

  // 路径 1：单图实况 image_info.live_photo（常见单图动图形态）
  const imageInfo = d.image_info || {};
  const topLive = imageInfo.live_photo;
  if (topLive === true || (typeof topLive === "object" && topLive !== null)) {
    const lp = topLive === true ? {} : topLive;
    const imgObj = lp.image || (Array.isArray(d.images) ? d.images[0] : null) || null;
    const imageUrl = imgObj ? pickImageUrl(imgObj) : "";
    const videoUrl = extractVideoUrl(lp.video);
    if (imageUrl && videoUrl) out.push({ index: 0, imageUrl, videoUrl });
  }
  if (out.length > 0) return out;

  // 路径 2：混合图文（slides）image_post_info.images / 普通 images
  const imgs = d.image_post_info?.images || d.images || [];
  imgs.forEach((img, i) => {
    if (!isLiveImage(img)) return;
    const imageUrl = pickImageUrl(img);
    const videoUrl = extractVideoUrl(img.video) || extractVideoUrl(img.live_photo_info?.video);
    if (imageUrl && videoUrl) out.push({ index: i, imageUrl, videoUrl });
  });
  return out;
}

/**
 * 编排：签名 → 请求 aweme/detail → 解析实况照片。
 * 失败（签名失效 / IP 被封 / 接口变更）返回 []，由调用方按"无实况"处理。
 */
export async function fetchLivePhotos(awemeId, { timeout = 15000 } = {}) {
  const sig = await signAwemeDetail(awemeId);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(sig.url, {
      headers: sig.headers,
      redirect: "follow",
      signal: ctrl.signal,
    });
    const txt = await res.text();
    let json;
    try {
      json = JSON.parse(txt);
    } catch {
      return [];
    }
    if (json.status_code && json.status_code !== 0) return [];
    return parseAwemeDetailLivePhotos(json);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
