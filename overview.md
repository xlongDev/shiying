# 图文帖多图 429 限流修复（2026-08-04）

## 问题背景
用户反馈 100 张图的图文帖解析后，前面若干张图正常，后面大量图显示紫色占位块。
从 dev 终端可见 `/api/proxy-media` 大量返回 **429 Too Many Requests**：

- `ImageSelectionGrid` 一次性渲染全部 100 个 `<img loading="lazy">`；
- 在 `max-h-[280px]` 的紧凑滚动容器内，浏览器把大量图片视为近视口，瞬间并发请求代理接口；
- `/api/proxy-media` 对单 IP 限速 60 req/60s，集中加载时迅速触顶；
- 上游抖音图片 CDN 同样对高频请求敏感，进一步加剧失败。

## 改动

### 新增 `src/components/lazy-image.tsx`
- 基于 `IntersectionObserver` 的精确懒加载：仅当图片进入视口才设置 `src` 发起真实请求（rootMargin 200px 预加载缓冲）。
- 加载中显示旋转骨架屏，加载失败按指数退避自动重试（最多 3 次，基础延迟 600ms）。
- 支持 `eager` 模式，用于图片浏览器当前大图立即加载。

### `src/components/image-selection-grid.tsx`
- 原生 `<img>` 替换为 `<LazyImage>`，避免不可见图片占用连接。

### `src/components/image-viewer-modal.tsx`
- 预览大图同样替换为 `<LazyImage eager>`，下载按钮逻辑保留 `buildMediaProxyUrl`。

### `src/app/api/proxy-media/route.ts`
- 单 IP 限流从 `60/60s` 放宽到 `120/60s`，降低 100 张图集中预览时误杀概率。
- 上游返回 429 时透传 `Retry-After`，让前端重试逻辑能拿到明确的等待时间。

## 验证
- `pnpm typecheck` ✅
- `pnpm lint` ✅ 0 error / 29 warning（warning 均为项目既有基线）

## 请在本机复测
刷新 `localhost:3000`，重新解析之前 100 张图的链接。图片应逐个懒加载，不再大面积 429；若个别请求仍遇到上游限流，`LazyImage` 会自动延迟重试。
