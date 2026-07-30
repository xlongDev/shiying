/**
 * 媒体 URL 构造 & 下载工具
 *
 * 集中管理代理 / 流地址拼接与 Blob 下载，供 video-result 与
 * live-photo-panel 等多个组件共用，避免循环依赖与重复代码。
 */

export function formatCount(n?: number): string {
  if (n === undefined || n === null) return "0";
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatDuration(sec?: number): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function sanitizeFilename(s: string): string {
  return (s || "video").replace(/[<>:"/\\|?*\x00-\x1f]/g, "").substring(0, 50) || "video";
}

export function buildMediaProxyUrl(url: string, filename: string): string {
  return `/api/proxy-media?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
}

export function buildProxyUrl(url: string, filename: string): string {
  return `/api/proxy?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
}

export function buildStreamUrl(url: string): string {
  return `/api/stream?url=${encodeURIComponent(url)}`;
}

export function buildExtractAudioUrl(url: string, filename: string, awemeId?: string): string {
  let apiUrl = `/api/extract-audio?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
  if (awemeId) apiUrl += `&awemeId=${encodeURIComponent(awemeId)}`;
  return apiUrl;
}

/** 触发浏览器下载一个 Blob（图片 / 视频 / 音频 / ZIP） */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
