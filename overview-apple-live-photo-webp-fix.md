# 苹果实况照片打包失败修复（封面 WebP → 浏览器端 canvas 转 JPEG）

## 问题

点击「保存为苹果实况照片」返回 500，服务端日志：

```
[ERROR] [apple-live-photo] 打包失败: 封面不是 JPEG 格式，需安装 ffmpeg 或设置 FFMPEG_PATH 后重试
POST /api/live-photo/apple 500
```

**根因**：抖音静帧现在统一下发 **WebP**（`~tplv-dy-lqen-new:1080:1920:q80.webp`），而苹果实况照片的静帧必须是 JPEG/HEIC。原实现里 `ensureJpegCover()` 只有 ffmpeg 一条转码路径 —— 与「不装 ffmpeg」的硬性要求直接冲突。

**先排除的思路**：把 CDN URL 后缀 `.webp` 改成 `.jpeg` 让 CDN 换格式 —— 无效，签名覆盖 path，返回 403。

## 方案：转码交给浏览器

浏览器原生就能解码 WebP，用 canvas 重编码成 JPEG 再上传。零新依赖、零安装。

```
[浏览器] fetch(/api/proxy-media) → createImageBitmap → canvas → toBlob(image/jpeg)
              ↓ multipart/form-data（cover 字段）
[服务端] 魔数校验 → 跳过下载 → 写 content identifier → 打成 .pvt ZIP
```

## 改动清单

| 文件 | 改动 |
| --- | --- |
| `src/lib/image-to-jpeg.ts` | **新增**。`fetchCoverAsJpeg` / `encodeBlobToJpeg` / `looksLikeJpeg` |
| `src/hooks/use-apple-live-photo.ts` | POST 改发 multipart，附带转好的 JPEG 封面；转码失败不阻断 |
| `src/app/api/live-photo/apple/route.ts` | `readPayload()` 同时支持 multipart 与 JSON；上传封面魔数校验 + 20MB 上限；错误脱敏分级 |
| `src/lib/apple-live-photo/package.ts` | `AppleLivePhotoInput.coverBuffer`；有它就跳过下载与 SSRF 校验；导出 `UserFacingError` |
| `src/lib/apple-live-photo.ts` | barrel 补导出 `isUserFacingError` |

### 关键实现细节

- **同源代理拉取**：必须走 `/api/proxy-media`，否则 canvas 被跨域污染，`toBlob()` 抛 `SecurityError`。
- **铺白底再绘制**：JPEG 无 alpha 通道，不铺底会让透明区域变成黑块。
- **魔数判断而非 Content-Type**：`FF D8 FF` 才算 JPEG；已是 JPEG 就原样透传，不重编码、不掉画质。
- **优雅降级**：`createImageBitmap` 不可用时兜底 `<img>` + objectURL（老 Safari）；客户端转码失败则退回服务端下载路径（装了 ffmpeg 仍可兜底）。
- **错误脱敏分级**：`userFacing` 标记的可行动文案原样透出，SSRF 收敛成「资源地址不合法」，其余给通用重试提示。路由用鸭子类型判断，不把打包实现拽进模块图。

## 验证

### 真机级配对测试（macOS Swift + PHLivePhoto）

| 场景 | 结果 |
| --- | --- |
| 真实抖音 WebP 封面 → JPEG（含 EXIF） | `LIVE PHOTO OK` |
| 同上（无 EXIF，等价 `canvas.toBlob` 输出） | `LIVE PHOTO OK` |
| **尺寸 + 宽高比双错配**（静帧 1080×1920 9:16 / 短片 320×240 4:3） | `LIVE PHOTO OK size=(1080.0, 1920.0)` |
| **真实 `createAppleLivePhotoPackage` 产出的 ZIP** → 解压 → 配对 | `LIVE PHOTO OK` |

第三项证明**尺寸不是硬约束**，抖音封面与短片分辨率不一致也没问题；第四项是完整生产链路的端到端证明。

### 质量门禁

- `pnpm typecheck` ✅
- `pnpm lint` ✅ 0 error / 45 warning
- `pnpm format:check` ✅
- `pnpm test` ✅ **157 项 / 22 个文件全过**

新增测试：`image-to-jpeg.test.ts`(9)、`apple-live-photo/package.test.ts`(4)，`route.test.ts` 扩到 16 项。

**踩坑**：jsdom 的 `Blob` 与 undici 的 `Response` 不兼容，测试里不能 `new Response(blob)`，改用最小 stub `{ ok, status, blob: async () => blob }`。

## 结论

ffmpeg 现在**只对「混入独立 BGM」有用**。封面转码已由浏览器接管，普通实况照片保存全链路零外部依赖。

代码尚未提交。
