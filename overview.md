# 本次工作概览

## 完成内容
为 note 类型（含单图实况/单图静态/多图图文）增加了「纯 API 实况存在性预检」，避免单图实况第一屏被误判为普通图文、也避免真静态帖误报「正在探测实况」。

## 关键改动
1. `src/lib/live-photo-resolver.ts`
   - 新增 `detectLivePhotoPresence(awemeId)`，仅走国内服务 + iesdouyin SSR 分享页，不启动无头浏览器。
   - 返回三种状态：`live`（含实况资源）、`static`（SSR 明确无实况标记）、`uncertain`（SSR 失败/WAF/数据不全）。

2. `src/app/api/parse/route.ts`
   - 对 `skipLivePhoto=true` 的 `note` 类型不再一刀切 `livePhotoBackground`。
   - `live` + 单图：直接填充实况资源，`isLivePhoto=true`。
   - `live` + 多图/资源不齐：`livePhotoPending=true`，显示探测中骨架屏。
   - `static`：不探测、不提示。
   - `uncertain`：保持静默浏览器兜底。

3. `src/lib/live-photo-resolver.test.ts`
   - 新增 4 个单测覆盖 `live` / `static` / WAF `uncertain` / 404 `uncertain`。

## 质量验证
- `pnpm typecheck` ✅
- `pnpm lint` ✅ 0 error（56 warning 基线）
- `pnpm test` ✅ 94/94
- `pnpm format:check` ✅

## 提交信息
- commit `7779311` 已 push 到 origin/main

## 待复测
- 用户截图中的单图实况链接，应第一屏即显示实况 UI 或「正在探测实况」，不再先显示普通图文。
- 已知真静态帖不应再出现任何探测提示。
- 若某些实况帖被 SSR 漏判为 `static`，需要进一步放宽预检策略。
