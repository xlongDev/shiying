/**
 * 统一的时间格式化函数（m:ss）。
 *
 * 同时被 glass 视频播放器与玻璃拟态音频播放器复用，替代原先两处各写一份的 `fmt`。
 * - 非有限值（NaN / Infinity）或负数一律回落为 "0:00"，避免渲染出 "NaN:NaN"。
 * - 分钟取整除 60，秒取模 60 并补零到两位。
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
