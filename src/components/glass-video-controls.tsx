"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

interface GlassVideoControlsProps {
  src: string;
  poster?: string;
  muted?: boolean;
  loop?: boolean;
  className?: string;
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * 液态玻璃风格视频播放器 — 替代原生 <video controls>
 *
 * - 毛玻璃中心播放按钮（带渐变光晕 + 边框）
 * - 底部渐变遮罩 + 毛玻璃控制条
 * - 可拖拽进度条、静音切换、三点菜单（速度/全屏/PiP/下载）
 * - hover / 触控时显示，3s 无操作自动隐藏
 */
export function GlassVideoControls({
  src,
  poster,
  muted: defaultMuted = true,
  loop = true,
  className = "",
}: GlassVideoControlsProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const progressRef = React.useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = React.useState(false);
  const [muted, setMuted] = React.useState(defaultMuted);
  const [progress, setProgress] = React.useState(0);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [controlsVisible, setControlsVisible] = React.useState(true);
  const [dragging, setDragging] = React.useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = React.useState(false);
  const [playbackRate, setPlaybackRate] = React.useState(1);
  const [menuPos, setMenuPos] = React.useState({ top: 0, left: 0 });
  const menuTriggerRef = React.useRef<HTMLButtonElement>(null);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  /* ---- 控制栏自动隐藏 ---- */
  const resetHideTimer = React.useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!dragging && !speedMenuOpen && playing) setControlsVisible(false);
    }, 3000);
  }, [dragging, speedMenuOpen, playing]);

  const handlePointerEnter = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setControlsVisible(true);
  };

  const handlePointerLeave = () => {
    if (playing && !dragging && !speedMenuOpen) {
      hideTimer.current = setTimeout(() => setControlsVisible(false), 1200);
    }
  };

  /* ---- 播放控制 ---- */
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
    resetHideTimer();
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    resetHideTimer();
  };

  const changeSpeed = (rate: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = rate;
    setPlaybackRate(rate);
    setSpeedMenuOpen(false);
    resetHideTimer();
  };

  /* ---- 全屏 ---- */
  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      /* ignore */
    }
    resetHideTimer();
  };

  /* ---- 画中画 ---- */
  const togglePiP = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await v.requestPictureInPicture();
      }
    } catch {
      /* PiP not supported */
    }
    resetHideTimer();
  };

  /* ---- 下载 ---- */
  const downloadVideo = async () => {
    const v = videoRef.current;
    if (!v || !v.src) return;
    try {
      const res = await fetch(v.src);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "实况动态短片.mp4";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
    resetHideTimer();
  };

  /* ---- 进度 ---- */
  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || dragging) return;
    const pct = v.duration > 0 ? (v.currentTime / v.duration) * 100 : 0;
    setProgress(pct);
    setCurrentTime(v.currentTime);
    setDuration(v.duration);
  };

  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (v) setDuration(v.duration);
  };

  const handleEnded = () => {
    setPlaying(false);
    setProgress(0);
    setCurrentTime(0);
  };

  /* ---- 进度拖拽 ---- */
  const seekTo = (clientX: number) => {
    const bar = progressRef.current;
    const v = videoRef.current;
    if (!bar || !v || !v.duration) return;
    const rect = bar.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = frac * v.duration;
    setProgress(frac * 100);
    setCurrentTime(frac * v.duration);
  };

  const handleProgressPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    setSpeedMenuOpen(false);
    setControlsVisible(true);
    seekTo(e.clientX);
    const onMove = (ev: PointerEvent) => seekTo(ev.clientX);
    const onUp = () => {
      setDragging(false);
      resetHideTimer();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  /* ---- 格式化时间 ---- */
  const fmt = (s: number) => {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  /* 关闭菜单（点击外部） */
  React.useEffect(() => {
    if (!speedMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-speed-menu]")) setSpeedMenuOpen(false);
    };
    // 延迟绑定避免立即触发
    const id = setTimeout(() => document.addEventListener("click", handler), 10);
    return () => {
      clearTimeout(id);
      document.removeEventListener("click", handler);
    };
  }, [speedMenuOpen]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden group/video ${className}`}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerMove={resetHideTimer}
    >
      {/* 视频 */}
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        muted={muted}
        loop={loop}
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPlay={() => {
          setPlaying(true);
          resetHideTimer();
        }}
        onPause={() => setPlaying(false)}
      />

      {/* 大面积点击播放 — 液态玻璃播放按钮 */}
      {!playing && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center z-10"
          aria-label="播放"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="relative h-[52px] w-[52px] rounded-full flex items-center justify-center"
            style={{
              background: "rgba(255,255,255,0.025)",
              backdropFilter: "blur(10px) saturate(140%)",
              WebkitBackdropFilter: "blur(10px) saturate(140%)",
              boxShadow:
                "0 0 0 1px rgba(255,255,255,0.06), 0 4px 16px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.05)",
            }}
          >
            {/* 内圈高光 — 更淡 */}
            <div
              className="absolute inset-[2px] rounded-full pointer-events-none"
              style={{
                background:
                  "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.015) 50%, rgba(255,255,255,0.04) 100%)",
              }}
            />
            <svg
              className="h-5 w-5 text-white/90 relative z-10 ml-0.5 drop-shadow-sm"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </motion.div>
        </button>
      )}

      {/* 底部渐变遮罩 */}
      <div className="absolute bottom-0 left-0 right-0 h-[40%] bg-gradient-to-t from-black/55 via-black/20 to-transparent pointer-events-none z-10" />

      {/* 控制条 */}
      <AnimatePresence>
        {(controlsVisible || dragging || !playing) && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="absolute bottom-0 left-0 right-0 z-20 px-2.5 pb-2 pt-5"
          >
            {/* 进度条 */}
            <div
              ref={progressRef}
              className="relative h-1 rounded-full cursor-pointer mb-2 group/progress"
              style={{ touchAction: "none" }}
              onPointerDown={handleProgressPointerDown as unknown as React.MouseEventHandler}
            >
              <div className="absolute inset-0 rounded-full bg-white/15" />
              <motion.div
                className="absolute left-0 top-0 bottom-0 rounded-full bg-gradient-to-r from-purple-400 to-pink-400"
                style={{ width: `${progress}%` }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.08, ease: "linear" }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-md opacity-0 group-hover/progress:opacity-100 group-focus-within/progress:opacity-100 transition-opacity"
                style={{ left: `calc(${progress}% - 5px)` }}
              />
            </div>

            {/* 控制按钮行 */}
            <div className="flex items-center gap-0.5">
              {/* 播放/暂停 */}
              <button
                onClick={togglePlay}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-white/90 hover:bg-white/12 transition-colors flex-shrink-0"
                aria-label={playing ? "暂停" : "播放"}
              >
                {playing ? (
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                  </svg>
                ) : (
                  <svg className="h-3.5 w-3.5 ml-[1px]" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              {/* 时间 */}
              <span className="text-[9px] text-white/60 font-mono tabular-nums select-none ml-0.5 mr-auto whitespace-nowrap">
                {fmt(currentTime)} / {fmt(duration)}
              </span>

              {/* 静音 */}
              <button
                onClick={toggleMute}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-white/80 hover:bg-white/12 transition-colors flex-shrink-0"
                aria-label={muted ? "取消静音" : "静音"}
              >
                {muted ? (
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                    />
                  </svg>
                ) : (
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z"
                    />
                  </svg>
                )}
              </button>

              {/* 三点菜单 */}
              <div className="relative" data-speed-menu>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const btn = menuTriggerRef.current;
                    if (btn) {
                      const rect = btn.getBoundingClientRect();
                      setMenuPos({
                        top: rect.top - 8,
                        left: rect.left + rect.width / 2,
                      });
                    }
                    setSpeedMenuOpen((o) => !o);
                    resetHideTimer();
                  }}
                  ref={menuTriggerRef}
                  className="h-7 w-7 rounded-lg flex items-center justify-center text-white/80 hover:bg-white/12 transition-colors flex-shrink-0"
                  aria-label="更多选项"
                >
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="5" r="1.5" />
                    <circle cx="12" cy="12" r="1.5" />
                    <circle cx="12" cy="19" r="1.5" />
                  </svg>
                </button>

                {/* 下拉菜单 — Portal 渲染 + 液态玻璃紧凑设计 */}
                {speedMenuOpen &&
                  createPortal(
                    <AnimatePresence>
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: -6 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: -6 }}
                        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                        className="fixed min-w-[116px] py-0.5 rounded-2xl overflow-hidden z-[9999]"
                        style={{
                          top: `${menuPos.top}px`,
                          left: `${menuPos.left}px`,
                          transform: "translateX(-50%)",
                          background: "rgba(20,20,28,0.80)",
                          backdropFilter: "blur(24px) saturate(180%)",
                          WebkitBackdropFilter: "blur(24px) saturate(180%)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          boxShadow:
                            "0 8px 32px rgba(0,0,0,0.40), 0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)",
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* 播放速度 */}
                        <div className="px-2 pt-1 pb-0.5">
                          <span className="text-[8px] uppercase tracking-widest text-white/30 font-medium">
                            速度
                          </span>
                        </div>
                        {SPEED_OPTIONS.map((rate) => (
                          <button
                            key={rate}
                            onClick={() => changeSpeed(rate)}
                            className={`w-full px-2.5 py-1 text-left text-[11px] font-mono flex items-center gap-1.5 transition-colors ${
                              playbackRate === rate
                                ? "text-purple-300"
                                : "text-white/60 hover:text-white/90"
                            }`}
                            style={
                              playbackRate === rate
                                ? { background: "rgba(168,85,247,0.12)" }
                                : undefined
                            }
                          >
                            {rate}x
                            {playbackRate === rate && (
                              <svg
                                className="h-2.5 w-2.5 ml-auto text-purple-400"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2.5}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            )}
                          </button>
                        ))}

                        {/* 分隔线 */}
                        <div className="mx-2 my-0.5 h-px bg-white/6" />

                        {/* 全屏 */}
                        <button
                          onClick={toggleFullscreen}
                          className="w-full px-2.5 py-1 text-left text-[11px] text-white/60 hover:text-white/90 transition-colors flex items-center gap-1.5"
                        >
                          <svg
                            className="h-3 w-3 text-white/40"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"
                            />
                          </svg>
                          全屏预览
                        </button>

                        {/* 画中画 */}
                        <button
                          onClick={togglePiP}
                          className="w-full px-2.5 py-1 text-left text-[11px] text-white/60 hover:text-white/90 transition-colors flex items-center gap-1.5"
                        >
                          <svg
                            className="h-3 w-3 text-white/40"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <rect x="2" y="3" width="20" height="14" rx="2" />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M8 21h8M12 17v4"
                            />
                          </svg>
                          画中画
                        </button>

                        {/* 下载 */}
                        <button
                          onClick={downloadVideo}
                          className="w-full px-2.5 py-1 text-left text-[11px] text-emerald-300/80 hover:text-emerald-300 transition-colors flex items-center gap-1.5"
                        >
                          <svg
                            className="h-3 w-3 text-emerald-400/60"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 4v12m0 0l-4-4m4 4l4-4"
                            />
                          </svg>
                          下载视频
                        </button>
                      </motion.div>
                    </AnimatePresence>,
                    document.body
                  )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
