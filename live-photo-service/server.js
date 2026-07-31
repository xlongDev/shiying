// 抖音实况照片解析服务 —— HTTP 入口。
// 仅依赖 Node 内置模块（node:http / node:vm / node:crypto），无需 npm install。
//
// 端点：
//   GET /parse-live-photo?awemeId=<数字>
//     → { ok:true, awemeId, livePhotos:[{index,imageUrl,videoUrl}] }
//   GET /healthz → "ok"
//
// 鉴权：设置环境变量 LIVE_PHOTO_SERVICE_TOKEN 后，请求须携带
//   Authorization: Bearer <token>  或  x-service-token: <token>
// 否则返回 403。未设置该变量时（本地调试）不鉴权。

import http from "node:http";
import { fetchLivePhotos } from "./lib.js";

const PORT = Number(process.env.PORT) || 3000;
const TOKEN = process.env.LIVE_PHOTO_SERVICE_TOKEN || "";

const server = http.createServer(async (req, res) => {
  // 允许跨域（Vercel 边缘函数跨域调用）
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "authorization, x-service-token, content-type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  let url;
  try {
    url = new URL(req.url, `http://localhost:${PORT}`);
  } catch {
    res.writeHead(400);
    res.end("bad request");
    return;
  }

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }

  if (url.pathname !== "/parse-live-photo") {
    res.writeHead(404);
    res.end("not found");
    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405);
    res.end("method not allowed");
    return;
  }

  // 鉴权
  if (TOKEN) {
    const auth = req.headers["authorization"] || "";
    const provided = auth.startsWith("Bearer ")
      ? auth.slice(7)
      : req.headers["x-service-token"] || "";
    if (provided !== TOKEN) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return;
    }
  }

  const awemeId = (url.searchParams.get("awemeId") || "").trim();
  if (!/^\d{5,30}$/.test(awemeId)) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "invalid awemeId (应为 5-30 位纯数字)" }));
    return;
  }

  try {
    const livePhotos = await fetchLivePhotos(awemeId);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, awemeId, livePhotos }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: msg }));
  }
});

server.listen(PORT, () => {
  console.log(`[live-photo-service] listening on :${PORT} (auth=${TOKEN ? "on" : "off"})`);
});
