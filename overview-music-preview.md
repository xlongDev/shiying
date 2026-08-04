# 音乐可预览（2026-08-04）

## 改动目标
普通视频帖与图文帖的「下载原声音乐」按钮原先只能下载，无法在线试听。本次在下载按钮上方接入已有的 `GlassAudioControls` 播放器，让 BGM 可以直接播放、暂停、拖拽进度、调节音量与倍速。

## 后端改动

### `src/app/api/download-music/route.ts`
- 新增 `preview=1` 查询参数。
- 预览模式下返回 `Content-Disposition: inline`，避免 `<audio>` 元素因 `attachment` 被部分浏览器交给下载管理器。

### `src/app/api/extract-audio/route.ts`
- 同样新增 `preview=1` 查询参数，预览模式返回 `inline`。

## 前端改动

### `src/lib/media-url.ts`
- 新增 `buildMusicPreviewUrl(awemeId, filename?)`：图文帖无独立音乐 URL 时，通过 `/api/download-music?awemeId=xxx&preview=1` 获取可播放音频。
- 新增 `buildExtractAudioPreviewUrl(url, filename?, awemeId?)`：普通视频无独立音乐 URL 时，通过 `/api/extract-audio?url=xxx&preview=1` 从视频中提取音频并预览。

### `src/components/video-result.tsx`
- 用 `React.useMemo` 计算 `musicPreviewSrc`：
  - 已有 `video.musicUrl` → `buildStreamUrl(...)`（支持 Range，最适合预览）。
  - 图文帖无 musicUrl → `buildMusicPreviewUrl(...)`。
  - 普通视频无 musicUrl → `buildExtractAudioPreviewUrl(...)`。
- 将 `musicPreviewSrc` 传入 `DownloadButtonRow`。

### `src/components/download-button-row.tsx`
- 新增 `musicPreviewSrc?: string | null` 属性。
- 在音乐下载按钮上方渲染 `GlassAudioControls`，仅在非实况/非混合实况/非探测中时显示，保持现有下载按钮逻辑不变。

## 验证
- `pnpm typecheck` ✅
- `pnpm lint` ✅ 0 error / 29 warning（warning 均为项目既有基线）
- `pnpm test -- src/components/glass-audio-controls.test.tsx` ✅ 全部通过
- `pnpm format:check` ✅

## 请在本机复测
解析普通视频或图文帖，结果卡片应出现音频预览条；点击播放按钮可直接试听背景音乐，进度条、音量、倍速菜单均可用；下载按钮保持原功能。
