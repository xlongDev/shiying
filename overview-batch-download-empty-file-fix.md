# 批量下载实况资源产生空 txt 文件修复（2026-08-04）

## 问题现象
混合实况卡片底部「批量下载全部实况资源」中的「全部原图」「全部短片」「快速合并」执行后，下载列表里会多出一个 0 B 的 `.txt` 文件（文件名类似 `dbe2e754...txt`）。

## 根因
这三个批量下载函数使用自定义 `fetchBlob`，在循环内部已经通过 `triggerBlobDownload` 手动触发了每个文件的下载，最后返回一个空的 `new Blob()` 来让 `useDownloadAction` 走成功流程。

但 `useDownloadAction` 拿到 Blob 后会无条件调用 `triggerBlobDownload(blob, filename)`，空 Blob 加上空的 `filename` 会被浏览器分配一个默认名（基于 Blob URL 的 UUID），最终表现为一个 0 B 的 txt 文件。

## 改动

### `src/hooks/use-download-action.ts`
- 在 `triggerBlobDownload` 前增加 `blob.size === 0` 判断。
- 如果 Blob 为空（通常意味着 `fetchBlob` 已自行处理所有下载），只更新成功状态、播放完成音效、显示 toast，不再触发额外的空文件下载。
- 非空 Blob 保持原有下载逻辑不变。

## 验证
- `pnpm typecheck` ✅
- `pnpm lint` ✅ 0 error / 29 warning（warning 均为项目既有基线）
- `pnpm test -- src/hooks/use-download-action.ts` ✅ 全部通过
- `pnpm format:check` ✅

## 请在本机复测
解析混合实况链接，分别点击「全部原图」「全部短片」「快速合并」，确认只下载预期的图片/视频，不再出现 0 B 的 txt 文件。
