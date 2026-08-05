"use client";

import * as React from "react";
import { Play, Pause, Volume2, Volume1, VolumeX, MoreVertical, Music } from "lucide-react";
import { formatTime } from "@/lib/format-time";
import { SpeedMenu } from "@/components/glass/speed-menu";
import { useAudioPlayer } from "@/hooks/use-audio-player";

/** 构造音频下载文件名；fileName 不含扩展名，统一追加 .mp3 */
export function buildAudioDownloadName(fileName?: string): string {
  const name = fileName?.trim() || "背景音乐";
  return `${name}.mp3`;
}

interface GlassAudioControlsProps {
  src: string;
  className?: string;
  /** 是否显示左上角「背景音乐」标签；在已经带有标题的场景中可关闭以避免重复 */
  showLabel?: boolean;
  /** 下载时使用的文件名（不含扩展名）；会统一追加 .mp3 */
  fileName?: string;
  /** 播放状态变化回调（封面 CD 旋转等场景需要获知），playing 变化时触发 */
  onPlayingChange?: (playing: boolean) => void;
}

export function GlassAudioControls({
  src,
  className = "",
  showLabel = true,
  fileName,
  onPlayingChange,
}: GlassAudioControlsProps) {
  const player = useAudioPlayer({ src });

  const {
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
  } = player;

  // 把播放状态冒泡给上层（如封面 CD 旋转）
  React.useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);

  const downloadAudio = () => {
    const a = audioRef.current;
    if (!a || !a.src) return;
    const name = buildAudioDownloadName(fileName);
    fetch(a.src)
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const el = document.createElement("a");
        el.href = url;
        el.download = name;
        el.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => {});
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
        onPlay={handleAudioPlay}
        onPause={handleAudioPause}
        onEnded={handleAudioEnded}
        onVolumeChange={() => {
          const a = audioRef.current;
          if (a) {
            // 同步外部状态（hook 内部已通过 toggleMute/changeVolume 管理，
            // 此处作为浏览器侧变更的兜底，如系统音量键）
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
        {formatTime(currentTime)} / {formatTime(duration)}
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
      <div className="relative flex-shrink-0">
        <button
          ref={menuTriggerRef}
          onClick={(e) => {
            e.stopPropagation();
            toggleMenu();
          }}
          className="h-6 w-6 sm:h-7 sm:w-7 rounded-full flex items-center justify-center transition-colors text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex-shrink-0"
          aria-label="更多选项"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>

        <SpeedMenu
          open={menuOpen}
          menuPos={menuPos}
          currentRate={playbackRate}
          onSelectRate={changeSpeed}
          onClose={() => setMenuOpen(false)}
          tone="audio"
          extraItems={
            <>
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
            </>
          }
        />
      </div>
    </div>
  );
}
