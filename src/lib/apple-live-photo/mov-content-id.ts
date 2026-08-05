/**
 * 给 MP4 / MOV 写入 QuickTime `com.apple.quicktime.content.identifier`（纯 JS）。
 *
 * 苹果实况照片的短片侧需要携带与静帧相同的 UUID。等价的 ffmpeg 写法是：
 *   ffmpeg -i in.mp4 -c copy -movflags use_metadata_tags \
 *          -metadata "com.apple.quicktime.content.identifier=UUID" out.mov
 * 本文件直接按 ISO-BMFF 盒子结构写出同样的字节，因此**无需 ffmpeg**：
 *
 *   moov
 *     └─ meta (FullBox, version+flags = 0)
 *          ├─ hdlr  handlerType = 'mdta'
 *          ├─ keys  1 项：namespace 'mdta' + "com.apple.quicktime.content.identifier"
 *          └─ ilst  item #1 → data(type=1 UTF-8) = UUID
 *
 * 【关键陷阱】stco/co64 里的 chunk offset 是**绝对文件偏移**。往 moov 里插入
 * 字节会把其后的 mdat 整体后移，若不同步修正这些偏移，视频会花屏/无法播放。
 * 处理办法：以拼接点为界，把所有 >= 拼接点的 chunk offset 加上 delta —— 这样
 * 无论 moov 在 mdat 之前（faststart）还是之后都正确。
 */

const QUICKTIME_CONTENT_ID_KEY = "com.apple.quicktime.content.identifier";

/** 需要向下递归查找 stco/co64 的容器盒子。 */
const CONTAINER_TYPES = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "udta"]);

interface Box {
  type: string;
  /** 盒子起始的文件偏移（含 size 字段）。 */
  start: number;
  /** 盒子结束偏移（不含）。 */
  end: number;
  /** 载荷起始偏移（跳过 size + type，以及 largesize）。 */
  bodyStart: number;
}

/** 解析 [start, end) 区间内的同级盒子列表。 */
export function parseBoxes(buf: Buffer, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString("latin1", p + 4, p + 8);
    let bodyStart = p + 8;
    if (size === 1) {
      if (p + 16 > end) break;
      const large = buf.readBigUInt64BE(p + 8);
      size = Number(large);
      bodyStart = p + 16;
    } else if (size === 0) {
      size = end - p; // 延伸到末尾
    }
    if (size < 8 || p + size > end) break;
    boxes.push({ type, start: p, end: p + size, bodyStart });
    p += size;
  }
  return boxes;
}

/**
 * 构造 moov/meta 盒子（hdlr + keys + ilst）。
 *
 * @param fullBox true 时在 'meta' 后写 4 字节 version+flags（ISO-BMFF 风格）。
 *   苹果 QuickTime 的 moov/meta **没有** version+flags，写了 AVFoundation 会解析失败
 *   （把那 4 个 0 当成下一个盒子的 size），实测必须为 false。
 */
export function buildMetaBox(assetId: string, fullBox = false): Buffer {
  const key = Buffer.from(QUICKTIME_CONTENT_ID_KEY, "utf8");
  const value = Buffer.from(assetId, "utf8");

  // hdlr：size + 'hdlr' + version/flags + predefined + 'mdta' + reserved[12] + 空名字
  const hdlr = Buffer.alloc(33);
  hdlr.writeUInt32BE(33, 0);
  hdlr.write("hdlr", 4, "latin1");
  hdlr.write("mdta", 16, "latin1");

  // keys：size(4) + 'keys'(4) + version/flags(4) + entryCount(4) + [keySize(4) + 'mdta'(4) + key]
  const keys = Buffer.alloc(24 + key.length);
  keys.writeUInt32BE(keys.length, 0);
  keys.write("keys", 4, "latin1");
  keys.writeUInt32BE(0, 8); // version + flags
  keys.writeUInt32BE(1, 12); // entryCount
  keys.writeUInt32BE(8 + key.length, 16);
  keys.write("mdta", 20, "latin1");
  key.copy(keys, 24);

  // ilst：size + 'ilst' + [itemSize + index + data(size + 'data' + type + locale + value)]
  const dataSize = 16 + value.length;
  const itemSize = 8 + dataSize;
  const ilst = Buffer.alloc(8 + itemSize);
  ilst.writeUInt32BE(ilst.length, 0);
  ilst.write("ilst", 4, "latin1");
  ilst.writeUInt32BE(itemSize, 8);
  ilst.writeUInt32BE(1, 12); // 指向 keys 里的第 1 个 key
  ilst.writeUInt32BE(dataSize, 16);
  ilst.write("data", 20, "latin1");
  ilst.writeUInt32BE(1, 24); // typeIndicator = 1（UTF-8）
  ilst.writeUInt32BE(0, 28); // locale
  value.copy(ilst, 32);

  const prefix = fullBox ? 4 : 0;
  const meta = Buffer.alloc(8 + prefix + hdlr.length + keys.length + ilst.length);
  meta.writeUInt32BE(meta.length, 0);
  meta.write("meta", 4, "latin1");
  if (fullBox) meta.writeUInt32BE(0, 8); // version + flags
  const body = 8 + prefix;
  hdlr.copy(meta, body);
  keys.copy(meta, body + hdlr.length);
  ilst.copy(meta, body + hdlr.length + keys.length);
  return meta;
}

/** 递归收集 moov 内所有 stco / co64 盒子。 */
function collectChunkOffsetBoxes(buf: Buffer, start: number, end: number, out: Box[]): void {
  for (const box of parseBoxes(buf, start, end)) {
    if (box.type === "stco" || box.type === "co64") {
      out.push(box);
    } else if (CONTAINER_TYPES.has(box.type)) {
      collectChunkOffsetBoxes(buf, box.bodyStart, box.end, out);
    }
  }
}

/** 把 >= splicePoint 的 chunk offset 平移 delta（原地修改 buf）。 */
function shiftChunkOffsets(buf: Buffer, boxes: Box[], splicePoint: number, delta: number): void {
  if (delta === 0) return;
  for (const box of boxes) {
    const entryCount = buf.readUInt32BE(box.bodyStart + 4); // 跳过 version + flags
    let p = box.bodyStart + 8;
    for (let i = 0; i < entryCount; i++) {
      if (box.type === "stco") {
        if (p + 4 > box.end) break;
        const v = buf.readUInt32BE(p);
        if (v >= splicePoint) buf.writeUInt32BE(v + delta, p);
        p += 4;
      } else {
        if (p + 8 > box.end) break;
        const v = buf.readBigUInt64BE(p);
        if (v >= BigInt(splicePoint)) buf.writeBigUInt64BE(v + BigInt(delta), p);
        p += 8;
      }
    }
  }
}

/**
 * 往 MP4/MOV 写入 content identifier，返回新的 Buffer。
 * moov 里若已有 meta 盒子则整体替换，否则追加到 moov 末尾。
 */
export function writeMovContentIdentifier(mp4: Buffer, assetId: string): Buffer {
  const top = parseBoxes(mp4, 0, mp4.length);
  const moov = top.find((b) => b.type === "moov");
  if (!moov) {
    throw new Error("视频缺少 moov 盒子，无法写入实况标识");
  }

  const newMeta = buildMetaBox(assetId);
  const existingMeta = parseBoxes(mp4, moov.bodyStart, moov.end).find((b) => b.type === "meta");

  const spliceStart = existingMeta ? existingMeta.start : moov.end;
  const spliceEnd = existingMeta ? existingMeta.end : moov.end;
  const delta = newMeta.length - (spliceEnd - spliceStart);

  // 先在原始布局上修正 chunk offset（此时各盒子位置还未变化），再做拼接
  const patched = Buffer.from(mp4);
  const chunkBoxes: Box[] = [];
  collectChunkOffsetBoxes(patched, moov.bodyStart, moov.end, chunkBoxes);
  shiftChunkOffsets(patched, chunkBoxes, spliceEnd, delta);

  const out = Buffer.concat([
    patched.subarray(0, spliceStart),
    newMeta,
    patched.subarray(spliceEnd),
  ]);

  // 修正 moov 自身的 size，需区分 32 位 / 64 位（size===1）/ 延伸到末尾（size===0）
  const rawSize = out.readUInt32BE(moov.start);
  if (rawSize === 1) {
    out.writeBigUInt64BE(out.readBigUInt64BE(moov.start + 8) + BigInt(delta), moov.start + 8);
  } else if (rawSize !== 0) {
    out.writeUInt32BE(rawSize + delta, moov.start);
  }
  return out;
}
