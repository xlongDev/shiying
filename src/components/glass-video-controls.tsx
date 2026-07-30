"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatTime } from "@/lib/format-time";
import { SpeedMenu } from "@/components/glass/speed-menu";
import { useVideoPlayer } from "@/hooks/use-video-player";

interface GlassVideoControlsProps {
  src: string;
  poster?: string;
  muted?: boolean;
  loop?: boolean;
  className?: string;
}

/**
 * 液态玻璃风格视频播放器 — 替代原生 <video controls>
 *
 * - 毛玻璃中心播放按钮（带渐变光晕 + 边框）
 * - 底部渐变遮罩 + 毛玻璃控制条
 * - 可拖拽进度条、静音切换、三点菜单（速度/全屏/PiP/下载）
 * - hover / 触控时显示，3s 无操作自动隐藏
 *
 * 播放状态机已抽离到 `useVideoPlayer`，本组件只负责渲染与把 DOM 行为接到事件上。
 */
export function GlassVideoControls({
  src,
  poster,
  muted: defaultMuted = true,
  loop = true,
  className = "",
}: GlassVideoControlsProps) {
  const player = useVideoPlayer({ defaultMuted });
  const {
    videoRef,
    containerRef,
    progressRef,
    menuTriggerRef,
    playing,
    muted,
    progress,
    currentTime,
    duration,
    controlsVisible,
    dragging,
    speedMenuOpen,
    playbackRate,
    menuPos,
    togglePlay,
    toggleMute,
    changeSpeed,
    toggleSpeedMenu,
    setSpeedMenuOpen,
    resetHideTimer,
    handlePointerEnter,
    handlePointerLeave,
    handlePlay,
    handlePause,
    handleTimeUpdate,
    handleLoadedMetadata,
    handleEnded,
    handleProgressPointerDown,
  } = player;

  /* ---- 全屏 / 画中画 / 下载（与具体菜单项绑定的 DOM 行为，留在组件侧） ---- */
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
        onPlay={handlePlay}
        onPause={handlePause}
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
              onPointerDown={handleProgressPointerDown}
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
                {formatTime(currentTime)} / {formatTime(duration)}
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
              <div className="relative">
                <button
                  onClick={toggleSpeedMenu}
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

                <SpeedMenu
                  open={speedMenuOpen}
                  menuPos={menuPos}
                  currentRate={playbackRate}
                  onSelectRate={changeSpeed}
                  onClose={() => setSpeedMenuOpen(false)}
                  tone="video"
                  extraItems={
                    <>
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
                    </>
                  }
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
