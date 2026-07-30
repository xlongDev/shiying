"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, Volume2, Volume1, VolumeX, MoreVertical, Music } from "lucide-react";

interface GlassAudioControlsProps {
  src: string;
  className?: string;
  /** 是否显示左上角「背景音乐」标签；在已经带有标题的场景中可关闭以避免重复 */
  showLabel?: boolean;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function GlassAudioControls({
  src,
  className = "",
  showLabel = true,
}: GlassAudioControlsProps) {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const progressRef = React.useRef<HTMLDivElement>(null);
  const volumeBarRef = React.useRef<HTMLDivElement>(null);
  const menuTriggerRef = React.useRef<HTMLButtonElement>(null);

  const progressRectRef = React.useRef<{ left: number; width: number } | null>(null);
  const volumeRectRef = React.useRef<{ left: number; width: number } | null>(null);

  // rAF 驱动的进度循环：以约 60fps 直接读取 currentTime，保证进度条线性顺滑、无阶梯感
  const rafRef = React.useRef<number | null>(null);
  const draggingRef = React.useRef(false);

  const [playing, setPlaying] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [volume, setVolume] = React.useState(1);
  const [muted, setMuted] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [menuPos, setMenuPos] = React.useState({ top: 0, left: 0 });
  const [playbackRate, setPlaybackRate] = React.useState(1);
  const [loop, setLoop] = React.useState(false);

  // rAF 驱动的进度循环：以约 60fps 直接读取 currentTime，保证进度条线性顺滑、无阶梯感
  // 取消并停止 rAF 循环
  const stopProgressRAF = React.useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // 每帧读取一次真实播放位置，直接驱动进度/thumb，避免依赖稀疏的 timeupdate 事件
  const progressTick = React.useCallback(() => {
    const a = audioRef.current;
    if (!a || !a.duration || draggingRef.current) {
      rafRef.current = null;
      return;
    }
    setProgress((a.currentTime / a.duration) * 100);
    setCurrentTime(a.currentTime);
    rafRef.current = requestAnimationFrame(progressTick);
  }, []);

  const startProgressRAF = React.useCallback(() => {
    stopProgressRAF();
    rafRef.current = requestAnimationFrame(progressTick);
  }, [stopProgressRAF, progressTick]);

  React.useEffect(() => {
    setProgress(0);
    setCurrentTime(0);
    setDuration(0);
    setPlaying(false);
    stopProgressRAF();
  }, [src, stopProgressRAF]);

  // 组件卸载时清理 rAF，避免内存泄漏
  React.useEffect(() => () => stopProgressRAF(), [stopProgressRAF]);

  React.useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-audio-menu]")) setMenuOpen(false);
    };
    const id = setTimeout(() => document.addEventListener("click", handler), 10);
    return () => {
      clearTimeout(id);
      document.removeEventListener("click", handler);
    };
  }, [menuOpen]);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };

  const toggleMute = () => {
    const a = audioRef.current;
    if (!a) return;
    a.muted = !a.muted;
    setMuted(a.muted);
  };

  const changeVolume = (v: number) => {
    const a = audioRef.current;
    const val = clamp01(v);
    if (a) {
      a.volume = val;
      a.muted = val === 0;
      setMuted(a.muted);
    }
    setVolume(val);
  };

  const handleTimeUpdate = () => {
    const a = audioRef.current;
    if (!a || draggingRef.current) return;
    // rAF 循环中已实时更新；此事件作为兜底（如标签页失焦暂停 rAF 时）
    if (rafRef.current == null) {
      setProgress(a.duration > 0 ? (a.currentTime / a.duration) * 100 : 0);
      setCurrentTime(a.currentTime);
      setDuration(a.duration);
    }
  };

  const handleLoadedMetadata = () => {
    const a = audioRef.current;
    if (a) setDuration(a.duration);
  };

  const seekTo = (clientX: number) => {
    const bar = progressRef.current;
    const a = audioRef.current;
    if (!bar || !a || !a.duration) return;
    const rect = progressRectRef.current ?? bar.getBoundingClientRect();
    const frac = clamp01((clientX - rect.left) / rect.width);
    a.currentTime = frac * a.duration;
    setProgress(frac * 100);
    setCurrentTime(frac * a.duration);
  };

  const handleProgressPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const bar = progressRef.current;
    if (!bar) return;
    const r = bar.getBoundingClientRect();
    progressRectRef.current = { left: r.left, width: r.width };
    draggingRef.current = true;
    setDragging(true);
    stopProgressRAF();
    try {
      bar.setPointerCapture(e.pointerId);
    } catch {}
    seekTo(e.clientX);
  };

  const handleProgressPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    seekTo(e.clientX);
  };

  const handleProgressPointerUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    progressRectRef.current = null;
    try {
      progressRef.current?.releasePointerCapture(e.pointerId);
    } catch {}
    // 拖拽结束且仍在播放时，恢复 rAF 线性推进
    if (audioRef.current && !audioRef.current.paused) startProgressRAF();
  };

  const volumeSeekTo = (clientX: number) => {
    const bar = volumeBarRef.current;
    if (!bar) return;
    const rect = volumeRectRef.current ?? bar.getBoundingClientRect();
    changeVolume(clamp01((clientX - rect.left) / rect.width));
  };

  const handleVolumePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const bar = volumeBarRef.current;
    if (!bar) return;
    const r = bar.getBoundingClientRect();
    volumeRectRef.current = { left: r.left, width: r.width };
    try {
      bar.setPointerCapture(e.pointerId);
    } catch {}
    volumeSeekTo(e.clientX);
  };

  const handleVolumePointerMove = (e: React.PointerEvent) => {
    if (!volumeRectRef.current) return;
    volumeSeekTo(e.clientX);
  };

  const handleVolumePointerUp = (e: React.PointerEvent) => {
    volumeRectRef.current = null;
    try {
      volumeBarRef.current?.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const fmt = (s: number) => {
    if (!isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const downloadAudio = () => {
    const a = audioRef.current;
    if (!a || !a.src) return;
    fetch(a.src)
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const el = document.createElement("a");
        el.href = url;
        el.download = "背景音乐.mp3";
        el.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => {});
    setMenuOpen(false);
  };

  const changeSpeed = (rate: number) => {
    const a = audioRef.current;
    if (a) {
      a.playbackRate = rate;
      setPlaybackRate(rate);
    }
    setMenuOpen(false);
  };

  const toggleLoop = () => {
    const a = audioRef.current;
    if (a) {
      a.loop = !a.loop;
      setLoop(a.loop);
    }
    setMenuOpen(false);
  };

  const fillGradient = "linear-gradient(90deg, #a855f7, #c084fc, #f472b6)";

  return (
    <div
      className={`group/audio flex items-center gap-1.5 sm:gap-2 rounded-full px-1.5 sm:px-2 py-1 sm:py-1.5 bg-white/70 dark:bg-slate-900/70 border border-white/55 dark:border-slate-700/50 min-w-0 ${className}`}
      style={{
        backdropFilter: "blur(16px) saturate(160%)",
        WebkitBackdropFilter: "blur(16px) saturate(160%)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.45), 0 4px 16px rgba(0,0,0,0.06)",
      }}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        loop={loop}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => {
          setPlaying(false);
          stopProgressRAF();
        }}
        onPlay={() => {
          setPlaying(true);
          startProgressRAF();
        }}
        onPause={() => {
          setPlaying(false);
          stopProgressRAF();
        }}
        onVolumeChange={() => {
          const a = audioRef.current;
          if (a) {
            setMuted(a.muted);
            setVolume(a.muted ? 0 : a.volume);
          }
        }}
      />

      {/* 标签：背景音乐 */}
      {showLabel && (
        <div
          className="hidden sm:flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full flex-shrink-0"
          style={{
            background: "linear-gradient(135deg, #9333ea, #d946ef)",
            boxShadow: "0 2px 8px rgba(147,51,234,0.25)",
          }}
        >
          <Music className="h-3 w-3 text-white" />
          <span className="text-[10px] sm:text-[11px] font-medium text-white whitespace-nowrap">
            背景音乐
          </span>
        </div>
      )}

      {/* 播放 / 暂停 */}
      <button
        onClick={togglePlay}
        className="h-6 w-6 sm:h-7 sm:w-7 rounded-full flex items-center justify-center flex-shrink-0 transition-transform hover:scale-105 active:scale-95"
        style={{
          background: "linear-gradient(135deg, #a855f7, #e879f9)",
          boxShadow: "0 2px 8px rgba(147,51,234,0.25)",
        }}
        aria-label={playing ? "暂停" : "播放"}
      >
        {playing ? (
          <Pause className="h-3 w-3 text-white" fill="currentColor" />
        ) : (
          <Play className="h-3 w-3 text-white ml-[1px]" fill="currentColor" />
        )}
      </button>

      {/* 时间 */}
      <span className="text-[10px] sm:text-[11px] font-medium tabular-nums select-none whitespace-nowrap min-w-0 text-center text-slate-600 dark:text-slate-300">
        {fmt(currentTime)} / {fmt(duration)}
      </span>

      {/* 进度条 */}
      <div
        ref={progressRef}
        className="group/prog relative h-5 flex-1 min-w-[80px] sm:min-w-[140px] rounded-full cursor-pointer select-none"
        style={{ touchAction: "none" }}
        onPointerDown={handleProgressPointerDown}
        onPointerMove={handleProgressPointerMove}
        onPointerUp={handleProgressPointerUp}
        onPointerCancel={handleProgressPointerUp}
      >
        <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-2 rounded-full bg-slate-200 dark:bg-slate-700" />
        <div
          className="absolute top-1/2 -translate-y-1/2 left-0 h-2 rounded-full"
          style={{
            width: `${Math.max(0, Math.min(100, progress))}%`,
            background: fillGradient,
            // rAF 已逐帧推进进度；用极短的线性过渡抹平丢帧带来的微小跳动，保持线性顺滑
            transition: dragging ? "none" : "width 0.06s linear",
            willChange: "width",
          }}
        />
        <div
          className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-[0_0_0_2px_rgba(147,51,234,0.45)] ${
            dragging
              ? "opacity-100 scale-125"
              : "opacity-0 group-hover/prog:opacity-100 group-hover/audio:opacity-100"
          }`}
          style={{
            left: `calc(${Math.max(0, Math.min(100, progress))}% - 6px)`,
            transition: dragging ? "none" : "left 0.06s linear, opacity 0.12s",
            willChange: "left",
          }}
        />
      </div>

      {/* 音量区 */}
      <div className="flex items-center gap-1 flex-shrink-0 min-w-0">
        <button
          onClick={toggleMute}
          className="h-6 w-6 sm:h-7 sm:w-7 rounded-full flex items-center justify-center transition-colors text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex-shrink-0"
          aria-label={muted ? "取消静音" : "静音"}
        >
          {muted || volume === 0 ? (
            <VolumeX className="h-3.5 w-3.5" />
          ) : volume < 0.5 ? (
            <Volume1 className="h-3.5 w-3.5" />
          ) : (
            <Volume2 className="h-3.5 w-3.5" />
          )}
        </button>
        <div
          ref={volumeBarRef}
          className="relative hidden sm:block h-1.5 w-9 sm:w-12 rounded-full cursor-pointer flex-shrink-0"
          style={{ touchAction: "none" }}
          onPointerDown={handleVolumePointerDown}
          onPointerMove={handleVolumePointerMove}
          onPointerUp={handleVolumePointerUp}
          onPointerCancel={handleVolumePointerUp}
        >
          <div className="absolute inset-0 rounded-full bg-slate-200 dark:bg-slate-700" />
          <div
            className="absolute left-0 top-0 bottom-0 rounded-full"
            style={{ width: `${(muted ? 0 : volume) * 100}%`, background: fillGradient }}
          />
        </div>
      </div>

      {/* 更多选项 */}
      <div className="relative flex-shrink-0" data-audio-menu>
        <button
          ref={menuTriggerRef}
          onClick={(e) => {
            e.stopPropagation();
            const btn = menuTriggerRef.current;
            if (btn) {
              const rect = btn.getBoundingClientRect();
              setMenuPos({ top: rect.top - 6, left: rect.left + rect.width / 2 });
            }
            setMenuOpen((o) => !o);
          }}
          className="h-6 w-6 sm:h-7 sm:w-7 rounded-full flex items-center justify-center transition-colors text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex-shrink-0"
          aria-label="更多选项"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>

        {menuOpen &&
          createPortal(
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -6 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="fixed min-w-[120px] py-1 rounded-2xl overflow-hidden z-[9999] bg-white/92 dark:bg-slate-900/95 border border-white/55 dark:border-slate-700/50"
                style={{
                  top: `${menuPos.top}px`,
                  left: `${menuPos.left}px`,
                  transform: "translateX(-50%)",
                  backdropFilter: "blur(24px) saturate(180%)",
                  WebkitBackdropFilter: "blur(24px) saturate(180%)",
                  boxShadow:
                    "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.45)",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-2 pt-1 pb-0.5">
                  <span className="text-[8px] uppercase tracking-widest text-slate-400 font-medium">
                    速度
                  </span>
                </div>
                {SPEED_OPTIONS.map((rate) => (
                  <button
                    key={rate}
                    onClick={() => changeSpeed(rate)}
                    className={`w-full px-2.5 py-1 text-left text-[11px] font-mono flex items-center gap-1.5 transition-colors ${
                      playbackRate === rate
                        ? "text-purple-600"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                    style={
                      playbackRate === rate ? { background: "rgba(168,85,247,0.10)" } : undefined
                    }
                  >
                    {rate}x
                    {playbackRate === rate && (
                      <svg
                        className="h-2.5 w-2.5 ml-auto text-purple-500"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
                <div className="mx-2 my-0.5 h-px bg-slate-200" />
                <button
                  onClick={toggleLoop}
                  className="w-full px-2.5 py-1 text-left text-[11px] text-slate-600 hover:text-slate-900 transition-colors flex items-center gap-1.5"
                >
                  <span className={loop ? "text-purple-600" : ""}>循环播放</span>
                  {loop && <span className="ml-auto text-[10px] text-purple-600">ON</span>}
                </button>
                <button
                  onClick={downloadAudio}
                  className="w-full px-2.5 py-1 text-left text-[11px] text-emerald-600 hover:text-emerald-700 transition-colors flex items-center gap-1.5"
                >
                  下载音乐
                </button>
              </motion.div>
            </AnimatePresence>,
            document.body
          )}
      </div>
    </div>
  );
}
