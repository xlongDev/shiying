# 单图实况合成预览（2026-08-04）

## 改动目标
单图实况链接原先只能直接下载「合并短片 + 背景音乐」，用户无法提前看到合成效果。本次在下载前增加预览入口，点击后先服务端合成并弹窗播放，满意后再下载。

## 后端改动

### `src/app/api/live-compose/route.ts`
- 新增 `preview=1` 查询参数。
- 预览模式下（包括音频失败返回纯视频的兜底分支）统一返回 `Content-Disposition: inline`，便于 `<video>` 元素直接播放。

## 前端改动

### 新增 `src/components/live-compose-preview-modal.tsx`
- 弹窗内调用 `/api/live-compose?preview=1` 进行服务端合成。
- 合成中显示「正在合成预览视频…」加载态。
- 合成失败显示错误信息。
- 合成成功后用 `URL.createObjectURL` 播放，弹窗内提供「下载合成视频」按钮，直接下载已合成的 Blob，避免二次请求。

### `src/components/single-live-photo-card.tsx`
- 新增 `onPreviewCompose` 回调。
- 原「合并短片 + 背景音乐」按钮拆分为并排两个按钮：
  - 「预览合成效果」（glass 风格）
  - 「下载合成视频」（紫粉渐变主按钮）

### `src/components/live-photo-panel.tsx`
- 新增 `composePreviewOpen` 状态。
- 实现 `handlePreviewCompose` 打开预览弹窗。
- 将 `onPreviewCompose` 传入 `SingleLivePhotoCard`。
- 在 `AnimatePresence` 外渲染 `LiveComposePreviewModal`。

## 验证
- `pnpm typecheck` ✅
- `pnpm lint` ✅ 0 error / 29 warning（warning 均为项目既有基线）
- `pnpm test -- src/components/live-photo-panel.test.tsx` ✅ 全部通过
- `pnpm format:check` ✅

## 请在本机复测
解析单图实况链接，点击「预览合成效果」，等待服务端合成后应弹窗播放带 BGM 的合成视频；预览满意后可点击「下载合成视频」保存到本地。
