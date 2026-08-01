# 本次工作概览

## 完成内容
修复 `detectLivePhotoPresence` 将单图实况误判为 `static` 的问题。抖音 SSR 分享页的 `_ROUTER_DATA` 对单图实况的图片对象常常不暴露 `live_photo` / `clipType` / `livePhotoType` 等标记（仅含 `uri` / `url_list` / 宽高），若把「无标记」判定为 `static`，会导致单图实况完全不触发实况探测。

## 关键改动
1. `src/lib/live-photo-resolver.ts`
   - `LivePhotoPresence` 类型移除 `static`，只保留 `live` / `uncertain`。
   - `detectLivePhotoPresence` 仅在 SSR 明确看到实况标记时返回 `live`，否则返回 `uncertain`，由浏览器兜底保证正确性。

2. `src/app/api/parse/route.ts`
   - 同步移除 `static` 分支；`uncertain` 时走 `livePhotoBackground` 静默浏览器兜底。

3. `src/lib/live-photo-resolver.test.ts`
   - 「SSR 无实况标记」测试由预期 `static` 改为预期 `uncertain`。

## 质量验证
- `pnpm typecheck` ✅
- `pnpm lint` ✅ 0 error（56 warning 基线）
- `pnpm test` ✅ 94/94
- `pnpm format:check` ✅

## 提交信息
- commit `f459204` 已 push 到 origin/main

## 待复测
- 用户截图中的单图实况链接 `https://v.douyin.com/4n8Xb54_UhQ/`，应触发 `livePhotoBackground` 静默浏览器兜底，约 8s 后自动切换为实况 UI。
- 真静态帖的短路仍由浏览器 fiber 统计完成（即后台探测时快速识别 0 实况并结束）。

## 后续优化方向
- 若希望避免单图实况走浏览器（8s），需要找到能返回完整实况标记的轻量 API；当前 a_bogus `aweme/detail` 返回的 item 对单图实况同样缺少标记。
