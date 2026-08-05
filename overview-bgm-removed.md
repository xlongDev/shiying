# 完全移除「混入独立 BGM」功能

## 决策
用户认为「独立 BGM 混音」并非刚需——抖音实况短片本就自带原声，于是整条链路回退，恢复为「静帧 + 短片（保留原声）直通打包」。

## 删除 / 改动清单

### 彻底删除
- `src/lib/live-photo-audio.ts` + 测试（`live-photo-audio.test.ts`）—— 浏览器 ffmpeg.wasm 混音实现，无引用后整文件移除
- `overview-bgm-browser-mux.md`

### 苹果实况照片打包（恢复零依赖基线）
- `src/lib/apple-live-photo/package.ts`：`AppleLivePhotoInput` 移除 `musicUrl` / `includeAudio` / `videoBuffer`；删除服务端混音分支与对应 SSRF/下载逻辑。
- `src/lib/apple-live-photo/ffmpeg.ts`：删除 `buildFfmpegArgs`（BGM 专用）；保留 `hasFfmpeg` / `buildImageToJpegArgs` / `runCommand` / `resolveFfmpegBin`（封面 WebP 兜底转码仍用）。
- `src/lib/apple-live-photo.ts`：barrel 不再导出 `buildFfmpegArgs`。
- `src/app/api/live-photo/apple/route.ts`：`ApplePayload` 移除 `musicUrl` / `includeAudio` / `videoBuffer`；GET 仅回 `{ available: true }`；POST 仅接 `imageUrl` / `videoUrl` / `cover`。
- `src/app/api/health/route.ts`：移除 `appleLivePhotoAudio` 字段与 `hasFfmpeg` 引用。

### 前端
- `src/hooks/use-apple-live-photo.ts`：移除 `mixing` 状态、`stageText`、`audioCapable`、GET 能力探测与 `live-photo-audio` 导入；`create()` 不再接收 `includeAudio`。
- `src/components/single-live-photo-card.tsx` / `mixed-live-photo-card.tsx`：移除 BGM 勾选框与提示、`mixing` 状态分支；按钮仅保留「打包中 / 已保存」；标题「背景音乐」→「原声」。

## 验证（全绿）
- `pnpm typecheck` ✅
- `pnpm lint` ✅ 0 error（warning 45，均为历史基线非 null 断言）
- `pnpm format:check` ✅
- `pnpm test` ✅ **152 项 / 22 文件全过**（移除 19 个 BGM 相关用例，原 171）

## 保留的独立功能（未动）
- **下载 BGM 音频**（抖音原声/汽水音乐下载）
- **实况合成视频**（静帧 + 短片 + BGM 合成为完整视频）

改动仍在**工作树未提交**（沿用「确认效果再提交」）。
