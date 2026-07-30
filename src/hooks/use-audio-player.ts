"use client";

import * as React from "react";

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export interface UseAudioPlayerOptions {
  /** 音频源 URL；变化时自动重置播放状态 */
  src: string;
  /** 是否循环播放（默认 false） */
  defaultLoop?: boolean;
}

export interface UseAudioPlayerResult {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  progressRef: React.RefObject<HTMLDivElement | null>;
  volumeBarRef: React.RefObject<HTMLDivElement | null>;
  menuTriggerRef: React.RefObject<HTMLButtonElement | null>;

  playing: boolean;
  progress: number;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  dragging: boolean;
  menuOpen: boolean;
  menuPos: { top: number; left: number };
  playbackRate: number;
  loop: boolean;

  togglePlay: () => void;
  toggleMute: () => void;
  changeVolume: (v: number) => void;
  changeSpeed: (rate: number) => void;
  toggleLoop: () => void;
  toggleMenu: () => void;
  setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleTimeUpdate: () => void;
  handleLoadedMetadata: () => void;
  handleProgressPointerDown: (e: React.PointerEvent) => void;
  handleProgressPointerMove: (e: React.PointerEvent) => void;
  handleProgressPointerUp: (e: React.PointerEvent) => void;
  handleVolumePointerDown: (e: React.PointerEvent) => void;
  handleVolumePointerMove: (e: React.PointerEvent) => void;
  handleVolumePointerUp: (e: React.PointerEvent) => void;
  /** <audio> onPlay 回调：启动 rAF 进度循环 */
  handleAudioPlay: () => void;
  /** <audio> onPause 回调：停止 rAF 进度循环 */
  handleAudioPause: () => void;
  /** <audio> onEnded 回调：非循环模式下停止 rAF */
  handleAudioEnded: () => void;
}

/**
 * 音频播放器状态机。
 *
 * 把 glass-audio-controls 内「播放/暂停、静音、音量拖拽、倍速、循环、
 * rAF 线性进度、进度 seek」等全部状态与控制逻辑收敛到一个自定义 hook，
 * 组件侧退化为纯渲染：把返回的 ref 绑到对应 DOM 节点、把 handler 接到事件上即可。
 *
 * 刻意【不】放入本 hook 的逻辑：下载音频 —— 这是与具体菜单项绑定的
 * DOM 行为，留在组件侧更合适。
 */
export function useAudioPlayer(options: UseAudioPlayerOptions): UseAudioPlayerResult {
  const { src, defaultLoop = false } = options;

  const audioRef = React.useRef<HTMLAudioElement>(null);
  const progressRef = React.useRef<HTMLDivElement>(null);
  const volumeBarRef = React.useRef<HTMLDivElement>(null);
  const menuTriggerRef = React.useRef<HTMLButtonElement>(null);

  const rafRef = React.useRef<number | null>(null);
  const draggingRef = React.useRef(false);
  const progressRectRef = React.useRef<{ left: number; width: number } | null>(null);
  const volumeRectRef = React.useRef<{ left: number; width: number } | null>(null);

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
  const [loop, setLoop] = React.useState(defaultLoop);

  /* ---- rAF 驱动的线性进度循环 ---- */

  const stopProgressRAF = React.useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

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

  /* ---- 源切换时重置 ---- */

  React.useEffect(() => {
    setProgress(0);
    setCurrentTime(0);
    setDuration(0);
    setPlaying(false);
    stopProgressRAF();
  }, [src, stopProgressRAF]);

  /* ---- 卸载时清理 rAF ---- */

  React.useEffect(() => () => stopProgressRAF(), [stopProgressRAF]);

  /* ---- 播放控制 ---- */

  const togglePlay = React.useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }, []);

  const toggleMute = React.useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.muted = !a.muted;
    setMuted(a.muted);
  }, []);

  const changeVolume = React.useCallback((v: number) => {
    const a = audioRef.current;
    const val = clamp01(v);
    if (a) {
      a.volume = val;
      a.muted = val === 0;
      setMuted(a.muted);
    }
    setVolume(val);
  }, []);

  const changeSpeed = React.useCallback((rate: number) => {
    const a = audioRef.current;
    if (a) {
      a.playbackRate = rate;
      setPlaybackRate(rate);
    }
    setMenuOpen(false);
  }, []);

  const toggleLoop = React.useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.loop = !a.loop;
      setLoop(a.loop);
    }
    setMenuOpen(false);
  }, []);

  /* ---- 菜单 ---- */

  const toggleMenu = React.useCallback(() => {
    const btn = menuTriggerRef.current;
    if (btn) {
      const rect = btn.getBoundingClientRect();
      setMenuPos({ top: rect.top - 6, left: rect.left + rect.width / 2 });
    }
    setMenuOpen((o) => !o);
  }, []);

  /* ---- 媒体事件 ---- */

  const handleTimeUpdate = React.useCallback(() => {
    const a = audioRef.current;
    if (!a || draggingRef.current) return;
    // rAF 循环中已实时更新；此事件作为兜底（如标签页失焦暂停 rAF 时）
    if (rafRef.current == null) {
      setProgress(a.duration > 0 ? (a.currentTime / a.duration) * 100 : 0);
      setCurrentTime(a.currentTime);
      setDuration(a.duration);
    }
  }, []);

  const handleLoadedMetadata = React.useCallback(() => {
    const a = audioRef.current;
    if (a) setDuration(a.duration);
  }, []);

  /* ---- 进度条拖拽 ---- */

  const seekTo = React.useCallback((clientX: number) => {
    const bar = progressRef.current;
    const a = audioRef.current;
    if (!bar || !a || !a.duration) return;
    const rect = progressRectRef.current ?? bar.getBoundingClientRect();
    const frac = clamp01((clientX - rect.left) / rect.width);
    a.currentTime = frac * a.duration;
    setProgress(frac * 100);
    setCurrentTime(frac * a.duration);
  }, []);

  const handleProgressPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
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
      } catch {
        /* setPointerCapture may fail if already captured */
      }
      seekTo(e.clientX);
    },
    [seekTo, stopProgressRAF]
  );

  const handleProgressPointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      seekTo(e.clientX);
    },
    [seekTo]
  );

  const handleProgressPointerUp = React.useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      progressRectRef.current = null;
      try {
        progressRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* release may fail if not captured */
      }
      // 拖拽结束且仍在播放时，恢复 rAF 线性推进
      if (audioRef.current && !audioRef.current.paused) startProgressRAF();
    },
    [startProgressRAF]
  );

  /* ---- 音量条拖拽 ---- */

  const volumeSeekTo = React.useCallback(
    (clientX: number) => {
      const bar = volumeBarRef.current;
      if (!bar) return;
      const rect = volumeRectRef.current ?? bar.getBoundingClientRect();
      changeVolume(clamp01((clientX - rect.left) / rect.width));
    },
    [changeVolume]
  );

  const handleVolumePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const bar = volumeBarRef.current;
      if (!bar) return;
      const r = bar.getBoundingClientRect();
      volumeRectRef.current = { left: r.left, width: r.width };
      try {
        bar.setPointerCapture(e.pointerId);
      } catch {
        /* setPointerCapture may fail if already captured */
      }
      volumeSeekTo(e.clientX);
    },
    [volumeSeekTo]
  );

  const handleVolumePointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      if (!volumeRectRef.current) return;
      volumeSeekTo(e.clientX);
    },
    [volumeSeekTo]
  );

  const handleVolumePointerUp = React.useCallback((e: React.PointerEvent) => {
    volumeRectRef.current = null;
    try {
      volumeBarRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* release may fail if not captured */
    }
  }, []);

  /* ---- 音频元素事件桥接（驱动 rAF 循环） ---- */

  const handleAudioPlay = React.useCallback(() => {
    setPlaying(true);
    startProgressRAF();
  }, [startProgressRAF]);

  const handleAudioPause = React.useCallback(() => {
    setPlaying(false);
    stopProgressRAF();
  }, [stopProgressRAF]);

  const handleAudioEnded = React.useCallback(() => {
    setPlaying(false);
    stopProgressRAF();
  }, [stopProgressRAF]);

  return {
    audioRef,
    progressRef,
    volumeBarRef,
    menuTriggerRef,
    playing,
    progress,
    currentTime,
    duration,
    volume,
    muted,
    dragging,
    menuOpen,
    menuPos,
    playbackRate,
    loop,
    togglePlay,
    toggleMute,
    changeVolume,
    changeSpeed,
    toggleLoop,
    toggleMenu,
    setMenuOpen,
    handleTimeUpdate,
    handleLoadedMetadata,
    handleProgressPointerDown,
    handleProgressPointerMove,
    handleProgressPointerUp,
    handleVolumePointerDown,
    handleVolumePointerMove,
    handleVolumePointerUp,
    handleAudioPlay,
    handleAudioPause,
    handleAudioEnded,
  };
}
