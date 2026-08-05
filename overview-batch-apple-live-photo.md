# 批量保存苹果实况照片 —— 实现总结

## 需求
链接里含多张实况图（slides 混合图文）时，支持一次性批量下载为苹果 Live Photo（.pvt）。

## 方案
在已有「批量下载全部 X 张实况资源」展开区里新增「全部实况」按钮；复用现有 `/api/live-photo/apple` 单张打包接口，浏览器端串行/限并发地逐张请求并触发下载。

## 改动文件

### 核心逻辑
- `src/hooks/use-apple-live-photo.ts`
  - 新增 `createBatch(livePhotos, filenameBase?)` 与 `batchProgress: { current; total }`。
  - 抽出 `uploadOne()` 供单张/批量复用。
  - 批量流程：先并行把全部封面 WebP → JPEG，再以并发数=2 逐张 POST 到 `/api/live-photo/apple`，避免同时请求过多。
  - 批量时通过 `filename` 字段带索引，确保下载文件名不重复（如 `live_photo_1_apple_live_photo.zip`）。

### UI
- `src/components/mixed-live-photo-card.tsx`
  - 批量下载展开区从 3 列扩为 4 列（小屏 2 列）。
  - 新增「全部实况」按钮，打包中显示「实况 2/5」进度；保留原有单张「保存为苹果实况照片」按钮。

### 测试
- 新增 `src/hooks/use-apple-live-photo.test.ts`（5 例）。
- 更新 `src/components/mixed-live-photo-card.test.tsx`（断言新增「全部实况」按钮）。

## 验证
- `pnpm typecheck` ✅
- `pnpm lint` ✅ 0 error / 45 warning（历史基线）
- `pnpm format:check` ✅
- `pnpm test` ✅ **157 项 / 23 文件全过**

## 状态
改动在工作树中，**未提交**（沿用「确认效果再提交」）。
