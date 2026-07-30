"use client";

import * as React from "react";

export interface UseVideoPlayerOptions {
  defaultMuted?: boolean;
}

export interface UseVideoPlayerResult {
  /** 绑定到 <video> 元素 */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** 绑定到最外层容器（全屏用） */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 绑定到进度条容器（拖拽 seek 用） */
  progressRef: React.RefObject<HTMLDivElement | null>;
  /** 绑定到「更多选项」触发按钮（菜单定位用） */
  menuTriggerRef: React.RefObject<HTMLButtonElement | null>;

  playing: boolean;
  muted: boolean;
  progress: number;
  currentTime: number;
  duration: number;
  controlsVisible: boolean;
  dragging: boolean;
  speedMenuOpen: boolean;
  playbackRate: number;
  menuPos: { top: number; left: number };

  togglePlay: () => void;
  toggleMute: () => void;
  changeSpeed: (rate: number) => void;
  /** 触发按钮点击：计算菜单定位并切换开关 + 重置隐藏计时 */
  toggleSpeedMenu: () => void;
  setSpeedMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;

  resetHideTimer: () => void;
  handlePointerEnter: () => void;
  handlePointerLeave: () => void;
  handlePlay: () => void;
  handlePause: () => void;
  handleTimeUpdate: () => void;
  handleLoadedMetadata: () => void;
  handleEnded: () => void;
  handleProgressPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}

/**
 * 视频播放器状态机。
 *
 * 把 glass-video-controls 内「播放/暂停、静音、倍速、进度、控制栏自动隐藏、进度拖拽」
 * 等全部状态与控制逻辑收敛到一个自定义 hook，组件侧退化为纯渲染：
 * 把返回的 ref 绑到对应 DOM 节点、把 handler 接到事件上即可。
 *
 * 刻意【不】放入本 hook 的逻辑：全屏 / 画中画 / 下载 —— 这些是与具体菜单项绑定的
 * DOM 行为，依赖渲染层结构，留在组件侧更合适，hook 仅通过 containerRef / videoRef
 * 把所需元素暴露出去。
 */
export function useVideoPlayer(options: UseVideoPlayerOptions = {}): UseVideoPlayerResult {
  const { defaultMuted = true } = options;

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const progressRef = React.useRef<HTMLDivElement>(null);
  const menuTriggerRef = React.useRef<HTMLButtonElement>(null);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

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

  /* ---- 控制栏自动隐藏 ---- */
  const resetHideTimer = React.useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!dragging && !speedMenuOpen && playing) setControlsVisible(false);
    }, 3000);
  }, [dragging, speedMenuOpen, playing]);

  const handlePointerEnter = React.useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setControlsVisible(true);
  }, []);

  const handlePointerLeave = React.useCallback(() => {
    if (playing && !dragging && !speedMenuOpen) {
      hideTimer.current = setTimeout(() => setControlsVisible(false), 1200);
    }
  }, [playing, dragging, speedMenuOpen]);

  /* ---- 播放控制 ---- */
  const togglePlay = React.useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
    resetHideTimer();
  }, [resetHideTimer]);

  const toggleMute = React.useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    resetHideTimer();
  }, [resetHideTimer]);

  const changeSpeed = React.useCallback(
    (rate: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.playbackRate = rate;
      setPlaybackRate(rate);
      setSpeedMenuOpen(false);
      resetHideTimer();
    },
    [resetHideTimer]
  );

  const toggleSpeedMenu = React.useCallback(() => {
    const btn = menuTriggerRef.current;
    if (btn) {
      const rect = btn.getBoundingClientRect();
      setMenuPos({ top: rect.top - 8, left: rect.left + rect.width / 2 });
    }
    setSpeedMenuOpen((o) => !o);
    resetHideTimer();
  }, [resetHideTimer]);

  const handlePlay = React.useCallback(() => {
    setPlaying(true);
    resetHideTimer();
  }, [resetHideTimer]);

  const handlePause = React.useCallback(() => setPlaying(false), []);

  /* ---- 进度 ---- */
  const handleTimeUpdate = React.useCallback(() => {
    const v = videoRef.current;
    if (!v || dragging) return;
    const pct = v.duration > 0 ? (v.currentTime / v.duration) * 100 : 0;
    setProgress(pct);
    setCurrentTime(v.currentTime);
    setDuration(v.duration);
  }, [dragging]);

  const handleLoadedMetadata = React.useCallback(() => {
    const v = videoRef.current;
    if (v) setDuration(v.duration);
  }, []);

  const handleEnded = React.useCallback(() => {
    setPlaying(false);
    setProgress(0);
    setCurrentTime(0);
  }, []);

  /* ---- 进度拖拽 ---- */
  const seekTo = React.useCallback((clientX: number) => {
    const bar = progressRef.current;
    const v = videoRef.current;
    if (!bar || !v || !v.duration) return;
    const rect = bar.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = frac * v.duration;
    setProgress(frac * 100);
    setCurrentTime(frac * v.duration);
  }, []);

  const handleProgressPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
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
    },
    [seekTo, resetHideTimer]
  );

  return {
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
  };
}
