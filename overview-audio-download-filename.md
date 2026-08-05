# 播放控制器下载音乐文件名修复

## 改动概要
通过播放器「更多选项 → 下载音乐」下载抖音背景音乐时，文件名现在使用歌曲元信息（`歌曲名 - 作者`），不再固定为 `背景音乐.mp3`。

## 修改文件

### `src/components/glass-audio-controls.tsx`
- 新增 `fileName?: string` prop：调用方传入不带扩展名的文件名。
- 新增导出工具函数 `buildAudioDownloadName(fileName?)`：
  - `fileName?.trim()` 存在时使用该名称 + `.mp3`；
  - 空值 / 空白字符串回退为 `背景音乐.mp3`。
- `downloadAudio()` 改用 `buildAudioDownloadName(fileName)` 设置 `<a download>`。

### `src/components/download-button-row.tsx`
- 向 `GlassAudioControls` 传入 `fileName`：
  - 有 `musicMeta` 时为 `${title}${author ? ` - ${author}` : ""}`；
  - 无元信息时回退为 `"背景音乐"`。
- 保持汽水音乐的真实歌名 / 作者优先，原声回退到已有兜底名。

### `src/components/glass-audio-controls.test.tsx`
- 新增 2 例测试，覆盖：
  - 有歌曲名时生成 `自由自在 - 朗鹅鎏汐.mp3`；
  - 无 `fileName`、空字符串、纯空白字符串时均回退为 `背景音乐.mp3`。

## 验证
- `pnpm typecheck` ✅
- `pnpm lint` ✅ 0 error / 45 warning（历史基线）
- `pnpm format:check` ✅
- `pnpm test` ✅ 159 项 / 23 文件全过

## 状态
改动在工作树中，未提交。