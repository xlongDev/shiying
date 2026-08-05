/**
 * 苹果实况照片打包 —— 兼容层 barrel。
 *
 * 具体实现按职责拆分在 `./apple-live-photo/` 下：
 *   - jpeg-content-id.ts  给 JPG 写 Apple MakerNote content identifier
 *   - mov-content-id.ts   给 MP4/MOV 写 QuickTime content identifier
 *   - ffmpeg.ts           可选增强（非 JPEG 封面转码兜底）
 *   - package.ts          端到端编排与 .pvt 打包
 */
export type {
  AppleLivePhotoInput,
  AppleLivePhotoResult,
  AppleLivePhotoCapability,
  UserFacingError,
} from "./apple-live-photo/package";

export {
  createAppleLivePhotoPackage,
  getAppleLivePhotoCapability,
  isUserFacingError,
  PVT_METADATA_PLIST,
} from "./apple-live-photo/package";

export { hasFfmpeg, resolveFfmpegBin, buildImageToJpegArgs } from "./apple-live-photo/ffmpeg";

export {
  writeJpegContentIdentifier,
  buildAppleMakerNote,
  buildExifApp1Payload,
  readTiffOrientation,
  isJpeg,
} from "./apple-live-photo/jpeg-content-id";

export {
  writeMovContentIdentifier,
  buildMetaBox,
  parseBoxes,
} from "./apple-live-photo/mov-content-id";
