# live-photo-service（抖音实况照片解析服务）

零浏览器方案：用纯 Node 实现抖音 Web 的 `a_bogus` 签名，调用 `aweme/v1/web/aweme/detail`
拿到含实况照片动态短片 URL 的完整 aweme 数据。**不依赖任何无头浏览器**，但**必须部署在
国内 IP 节点**（海外 IP 会被抖音地理封锁返回空响应——这一点已在 Vercel 上诊断确认）。

前端（Vercel，海外）通过 HTTPS 转发调用本服务，从而在不使用浏览器的情况下解析
slides 多图实况照片。

## 为什么需要它

抖音实况照片（尤其是多图 slides 动态短片）的数据**不在 SSR 分享页里**，且 `iteminfo`
接口现已被强制 `a_bogus` 签名校验。纯 Vercel 环境无法拿到，只能：

- 方案 A（本服务）：在国内节点跑 `a_bogus` 签名 → `aweme/detail`，**零浏览器**。✅ 已选
- 方案 B：在国内节点跑真 Chrome（Puppeteer）注水 → 最稳但重。

## 目录结构

```
lib.js            核心库：a_bogus 生成 + aweme/detail 解析（无副作用，可单测）
server.js         HTTP 入口：GET /parse-live-photo + Token 鉴权
abogus-vendor.js  AUTO-GENERATED：内联 ylcangel/douyin_sign 的 SM3 + CORE 源码
package.json      纯 ESM，无依赖
Dockerfile        node:20-alpine，镜像极小（无 Chrome）
```

## 本地运行

```bash
cd live-photo-service
node server.js
# 测试（需在能访问抖音的国内网络环境下）
curl "http://localhost:3000/parse-live-photo?awemeId=7635491506937597834"
```

本地不设 `LIVE_PHOTO_SERVICE_TOKEN` 时不鉴权。

## 部署（国内节点）

### 方式一：Docker（任意国内云主机 / 轻量服务器）

```bash
docker build -t live-photo-service .
docker run -d --restart=always -p 3000:3000 \
  -e LIVE_PHOTO_SERVICE_TOKEN=<一段随机强令牌> \
  live-photo-service
```

### 方式二：裸 Node（轻量服务器）

```bash
cd live-photo-service
node server.js   # 建议用 pm2 / systemd 守护
```

### 必须做的事

1. **放在国内 IP**：腾讯云 / 阿里云 / 华为云等大陆节点，或香港节点（需实测）。
2. **HTTPS 域名暴露**：Vercel 只能调 HTTPS。用 Nginx/Caddy 反代 + 免费证书，
   或直接用云厂商的应用托管 HTTPS。
3. **设置强 Token**：`LIVE_PHOTO_SERVICE_TOKEN`，并在前端配置一致的值。
   建议再加一层云防火墙只放行 Vercel 出站 IP。

## 环境变量

| 变量 | 说明 | 默认 |
|---|---|---|
| `PORT` | 监听端口 | `3000` |
| `LIVE_PHOTO_SERVICE_TOKEN` | 鉴权令牌；设置后请求须带 `Authorization: Bearer <token>` 或 `x-service-token` | 空（不鉴权） |

## 接口

`GET /parse-live-photo?awemeId=<数字>`

成功返回：

```json
{
  "ok": true,
  "awemeId": "7635491506937597834",
  "livePhotos": [
    { "index": 0, "imageUrl": "https://...douyinpic...", "videoUrl": "https://...douyinvod..." }
  ]
}
```

- `livePhotos` 为空数组 `[]` 表示该帖子无实况（或解析失败），前端按"无实况"处理。
- 异常返回 `{ "ok": false, "error": "..." }`。

## 前端接入

在主项目 `src/lib/live-photo-resolver.ts` 中，当环境变量 `LIVE_PHOTO_SERVICE_URL`
配置时，`resolveLivePhotoVideoUrl` / `resolveLivePhotosForSlides` 会**优先**调用本服务，
失败再回退 SSR / 本地 Chrome。

Vercel 环境变量（Production / Preview 都设）：

```
LIVE_PHOTO_SERVICE_URL=https://你的服务域名
LIVE_PHOTO_SERVICE_TOKEN=<与上面服务一致的令牌>
```

## 维护提示

`a_bogus` 是逆向算法，抖音会周期性更换 JSVMP 版本（`abogus-vendor.js` 当前对应
`v1.0.1.19-fix.01`）。若某天实况突然解析失败，优先排查签名版本是否过期，再到
`github.com/ylcangel/douyin_sign` 同步上游后重新生成 `abogus-vendor.js`。
