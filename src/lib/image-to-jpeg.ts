/**
 * 浏览器端图片转 JPEG —— 零依赖。
 *
 * 背景：抖音的封面/静帧现在统一下发 WebP（`~tplv-dy-lqen-new:1080:1920:q80.webp`），
 * 而苹果实况照片的静帧必须是 JPEG（或 HEIC）。服务端要转码就得装 ffmpeg，
 * 但浏览器本来就**原生支持解码 WebP**，再用 canvas 编码成 JPEG 即可，
 * 不需要任何外部依赖（ffmpeg / sharp / wasm 全都不用）。
 *
 * 走同源的 `/api/proxy-media` 拉取，因此 canvas 不会被跨域污染，
 * `toBlob()` 可以正常导出。
 */
"use client";

import { buildMediaProxyUrl } from "./media-url";

/** canvas 重编码质量。0.95 在体积与画质之间取平衡（视觉上无损）。 */
const JPEG_QUALITY = 0.95;

/** 按魔数判断是否已经是 JPEG（FF D8 FF），不信任 Content-Type。 */
export function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/** 解码任意浏览器可识别的图片格式（WebP / PNG / AVIF / GIF …）。 */
async function decodeImage(blob: Blob): Promise<DecodedImage> {
  // 首选 createImageBitmap：不进 DOM、可 close 释放，解码在后台线程
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  }

  // 兜底：<img> + objectURL（Safari 老版本没有 createImageBitmap）
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("图片解码失败"));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas 导出 JPEG 失败"))),
      "image/jpeg",
      quality
    );
  });
}

/** 把任意图片 Blob 重编码成 JPEG Blob。 */
export async function encodeBlobToJpeg(blob: Blob, quality = JPEG_QUALITY): Promise<Blob> {
  const decoded = await decodeImage(blob);
  try {
    if (!decoded.width || !decoded.height) {
      throw new Error("图片尺寸无效");
    }
    const canvas = document.createElement("canvas");
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建 2D 画布上下文");
    // JPEG 不支持透明通道，先铺白底，避免透明区域变成黑块
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(decoded.source, 0, 0);
    return await canvasToJpeg(canvas, quality);
  } finally {
    decoded.release();
  }
}

/**
 * 拉取封面并保证产出 JPEG。
 * 已经是 JPEG 就原样返回（不重编码、不掉画质），否则用 canvas 转码。
 */
export async function fetchCoverAsJpeg(imageUrl: string): Promise<Blob> {
  const res = await fetch(buildMediaProxyUrl(imageUrl, "cover.jpg"));
  if (!res.ok) throw new Error(`封面下载失败（HTTP ${res.status}）`);
  const blob = await res.blob();
  const head = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
  if (looksLikeJpeg(head)) return blob;
  return encodeBlobToJpeg(blob);
}
