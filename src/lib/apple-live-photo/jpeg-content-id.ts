/**
 * 给 JPEG 写入 Apple Live Photo 的 content identifier（纯 JS，无外部依赖）。
 *
 * 苹果实况照片的「配对」机制：静帧与短片各自携带同一个 UUID。
 *   - 图片侧：EXIF → MakerNote（tag 0x927C）→ Apple MakerNote 内 tag 0x0011
 *     （即 ImageIO 的 `kCGImagePropertyMakerAppleDictionary["17"]`）
 *   - 视频侧：QuickTime metadata `com.apple.quicktime.content.identifier`
 *
 * 本文件的字节布局逆向自 macOS ImageIO 亲自产出的参考文件，逐字节对齐：
 *
 *   TIFF(big-endian "MM")
 *     0  4d4d 002a 0000_0008        header，IFD0 位于 8
 *     8  IFD0: [0x0112 Orientation?] + [0x8769 ExifIFDPointer -> exifIfdOffset]
 *        ExifIFD: [0x927C MakerNote, type=UNDEFINED, count=mnLen, off=mnOffset]
 *        MakerNote:
 *          +0   "Apple iOS\0"      (10B)
 *          +10  00 01              (2B)
 *          +12  "MM"               (2B)
 *          +14  IFD: 1 项 → tag 0x0011, ASCII, count=len+1, valueOffset=32
 *          +32  UUID 字符串 + NUL
 *
 * 【关键】MakerNote 内部 IFD 的 valueOffset 基准是 **MakerNote 块起点**，
 * 不是 TIFF header 起点（参考样本：字符串位于 TIFF 偏移 100，MakerNote 起点 68，
 * 写入值 32 = 100 - 68）。写错基准会导致 Photos 静默配对失败。
 */

/** "Apple iOS\0" + 0x0001 + "MM"，共 14 字节。 */
const APPLE_MAKER_NOTE_HEADER = Buffer.from([
  0x41, 0x70, 0x70, 0x6c, 0x65, 0x20, 0x69, 0x4f, 0x53, 0x00, 0x00, 0x01, 0x4d, 0x4d,
]);

const TAG_CONTENT_IDENTIFIER = 0x0011;
const TAG_ORIENTATION = 0x0112;
const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_MAKER_NOTE = 0x927c;

const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_ASCII = 2;
const TYPE_UNDEFINED = 7;

const EXIF_ID = Buffer.from("Exif\0\0", "latin1");

/** 构造 Apple MakerNote 数据块（含 content identifier）。 */
export function buildAppleMakerNote(assetId: string): Buffer {
  const value = Buffer.from(`${assetId}\0`, "ascii");
  const ifd = Buffer.alloc(2 + 12 + 4);
  ifd.writeUInt16BE(1, 0); // 项数
  ifd.writeUInt16BE(TAG_CONTENT_IDENTIFIER, 2);
  ifd.writeUInt16BE(TYPE_ASCII, 4);
  ifd.writeUInt32BE(value.length, 6);
  // valueOffset 相对 MakerNote 块起点：header(14) + IFD(18) = 32
  ifd.writeUInt32BE(APPLE_MAKER_NOTE_HEADER.length + ifd.length, 10);
  ifd.writeUInt32BE(0, 14); // 无下一个 IFD
  return Buffer.concat([APPLE_MAKER_NOTE_HEADER, ifd, value]);
}

/** 构造完整的 APP1 段负载（`Exif\0\0` + TIFF）。 */
export function buildExifApp1Payload(assetId: string, orientation?: number): Buffer {
  const makerNote = buildAppleMakerNote(assetId);
  const keepOrientation = typeof orientation === "number" && orientation >= 1 && orientation <= 8;

  const ifd0Count = keepOrientation ? 2 : 1;
  const ifd0Size = 2 + 12 * ifd0Count + 4;
  const exifIfdOffset = 8 + ifd0Size;
  const exifIfdSize = 2 + 12 + 4;
  const makerNoteOffset = exifIfdOffset + exifIfdSize;

  const tiff = Buffer.alloc(makerNoteOffset + makerNote.length);
  tiff.write("MM", 0, "ascii");
  tiff.writeUInt16BE(0x002a, 2);
  tiff.writeUInt32BE(8, 4);

  let p = 8;
  tiff.writeUInt16BE(ifd0Count, p);
  p += 2;
  // EXIF 要求 IFD 内条目按 tag 升序：0x0112 < 0x8769
  if (keepOrientation) {
    tiff.writeUInt16BE(TAG_ORIENTATION, p);
    tiff.writeUInt16BE(TYPE_SHORT, p + 2);
    tiff.writeUInt32BE(1, p + 4);
    tiff.writeUInt16BE(orientation as number, p + 8); // SHORT 左对齐存放
    tiff.writeUInt16BE(0, p + 10);
    p += 12;
  }
  tiff.writeUInt16BE(TAG_EXIF_IFD_POINTER, p);
  tiff.writeUInt16BE(TYPE_LONG, p + 2);
  tiff.writeUInt32BE(1, p + 4);
  tiff.writeUInt32BE(exifIfdOffset, p + 8);
  p += 12;
  tiff.writeUInt32BE(0, p); // IFD0 无下一个 IFD
  p += 4;

  // ExifIFD：只放 MakerNote
  tiff.writeUInt16BE(1, p);
  p += 2;
  tiff.writeUInt16BE(TAG_MAKER_NOTE, p);
  tiff.writeUInt16BE(TYPE_UNDEFINED, p + 2);
  tiff.writeUInt32BE(makerNote.length, p + 4);
  tiff.writeUInt32BE(makerNoteOffset, p + 8);
  p += 12;
  tiff.writeUInt32BE(0, p);

  makerNote.copy(tiff, makerNoteOffset);
  return Buffer.concat([EXIF_ID, tiff]);
}

/** 从 TIFF 数据里读出 IFD0 的 Orientation（读不到返回 undefined）。 */
export function readTiffOrientation(tiff: Buffer): number | undefined {
  if (tiff.length < 8) return undefined;
  const bom = tiff.toString("latin1", 0, 2);
  const be = bom === "MM";
  if (!be && bom !== "II") return undefined;
  const u16 = (o: number) => (be ? tiff.readUInt16BE(o) : tiff.readUInt16LE(o));
  const u32 = (o: number) => (be ? tiff.readUInt32BE(o) : tiff.readUInt32LE(o));
  if (u16(2) !== 0x002a) return undefined;

  const ifd0 = u32(4);
  if (ifd0 + 2 > tiff.length) return undefined;
  const count = u16(ifd0);
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    if (u16(entry) === TAG_ORIENTATION) {
      const v = u16(entry + 8);
      return v >= 1 && v <= 8 ? v : undefined;
    }
  }
  return undefined;
}

/** 没有长度字段的独立标记（不含 SOI/EOI，它们单独处理）。 */
function isStandaloneMarker(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

export function isJpeg(buf: Buffer): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/**
 * 把 content identifier 写进 JPEG：剔除原有 Exif APP1（沿用其 Orientation），
 * 在 SOI 之后插入我们构造的 APP1。返回新的 JPEG Buffer。
 */
export function writeJpegContentIdentifier(jpeg: Buffer, assetId: string): Buffer {
  if (!isJpeg(jpeg)) {
    throw new Error("封面不是 JPEG，无法写入实况标识");
  }

  const keep: Buffer[] = [];
  let orientation: number | undefined;
  let p = 2;

  while (p + 1 < jpeg.length) {
    if (jpeg[p] !== 0xff) break; // 结构异常，剩余部分整体保留
    const marker = jpeg[p + 1];

    if (marker === 0xd9) break; // EOI
    if (isStandaloneMarker(marker)) {
      keep.push(jpeg.subarray(p, p + 2));
      p += 2;
      continue;
    }
    if (marker === 0xda) break; // SOS：其后是熵编码数据，原样保留

    if (p + 4 > jpeg.length) break;
    const len = jpeg.readUInt16BE(p + 2);
    const segEnd = p + 2 + len;
    if (len < 2 || segEnd > jpeg.length) break;

    const isExifApp1 =
      marker === 0xe1 && jpeg.subarray(p + 4, p + 4 + 6).equals(EXIF_ID) && len >= 8;
    if (isExifApp1) {
      orientation = readTiffOrientation(jpeg.subarray(p + 4 + 6, segEnd));
      // 丢弃原 APP1，由我们重建
    } else {
      keep.push(jpeg.subarray(p, segEnd));
    }
    p = segEnd;
  }

  const payload = buildExifApp1Payload(assetId, orientation);
  const app1 = Buffer.alloc(4 + payload.length);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);
  payload.copy(app1, 4);

  return Buffer.concat([jpeg.subarray(0, 2), app1, ...keep, jpeg.subarray(p)]);
}
