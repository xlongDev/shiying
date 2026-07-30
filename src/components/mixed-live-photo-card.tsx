"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Check,
  Music,
  Film,
  Video,
  Image as ImageIcon,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { LivePhotoIcon } from "@/components/live-photo-icon";
import { GlassVideoControls } from "@/components/glass-video-controls";
import { GlassAudioControls } from "@/components/glass-audio-controls";
import { cn } from "@/lib/utils";
import { buildMediaProxyUrl, buildStreamUrl } from "@/lib/media-url";
import type { LivePhotoInfo, ParsedVideo } from "@/lib/parser";
import type { DownloadState } from "@/hooks/use-media-downloader";

interface MixedLivePhotoCardProps {
  video: ParsedVideo;
  livePhotos: LivePhotoInfo[];
  selectedLiveIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onSelectIndex: (i: number) => void;
  batchOpen: boolean;
  onToggleBatch: () => void;
  imageState: DownloadState;
  videoState: DownloadState;
  musicState: DownloadState;
  composeState: DownloadState;
  onDownloadSelectedImage: () => void;
  onDownloadSelectedVideo: () => void;
  onDownloadMixedMusic: () => void;
  onOpenComposeModal: () => void;
  onDownloadLiveImages: () => void;
  onDownloadLiveVideos: () => void;
  onComposeMixedLive: () => void;
}

/**
 * 混合实况照片预览与下载卡片（支持多实况切换、批量下载）。
 */
export function MixedLivePhotoCard({
  video,
  livePhotos,
  selectedLiveIndex,
  onPrev,
  onNext,
  onSelectIndex,
  batchOpen,
  onToggleBatch,
  imageState,
  videoState,
  musicState,
  composeState,
  onDownloadSelectedImage,
  onDownloadSelectedVideo,
  onDownloadMixedMusic,
  onOpenComposeModal,
  onDownloadLiveImages,
  onDownloadLiveVideos,
  onComposeMixedLive,
}: MixedLivePhotoCardProps) {
  const reduce = useReducedMotion();
  const slideY = reduce ? 0 : 12;
  const exitY = reduce ? 0 : -8;

  const containerVariants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: slideY },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
    },
  };
  const batchContainerVariants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
  };
  const batchButtonVariants = {
    hidden: { opacity: 0, y: reduce ? 0 : 8, scale: reduce ? 1 : 0.96 },
    show: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
    },
  };

  const currentLp = livePhotos[selectedLiveIndex] || livePhotos[0];
  const totalLive = livePhotos.length;
  const hasMultipleLive = totalLive > 1;

  return (
    <motion.div
      key="mixed-live"
      layout
      initial={{ opacity: 0, y: slideY }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
      }}
      exit={{
        opacity: 0,
        y: exitY,
        transition: { duration: 0.26, ease: [0.7, 0, 0.84, 0] as [number, number, number, number] },
      }}
      className="space-y-2.5 rounded-2xl glass p-4 border border-purple-400/20"
    >
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="space-y-2.5"
      >
        <motion.div variants={itemVariants} className="flex items-center gap-2 mb-1">
          <LivePhotoIcon size={16} className="text-purple-400" />
          <span className="text-sm font-semibold">实况照片</span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-400/25">
            {totalLive} 张
          </span>
          {hasMultipleLive && (
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={onPrev}
                aria-label="上一张实况"
                className="h-6 w-6 rounded-full glass flex items-center justify-center hover:bg-primary/10 transition-colors disabled:opacity-30"
                disabled={totalLive <= 1}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs text-muted-foreground min-w-[48px] text-center">
                {selectedLiveIndex + 1} / {totalLive}
              </span>
              <button
                onClick={onNext}
                aria-label="下一张实况"
                className="h-6 w-6 rounded-full glass flex items-center justify-center hover:bg-primary/10 transition-colors disabled:opacity-30"
                disabled={totalLive <= 1}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <span className="text-[10px] text-muted-foreground ml-auto">
            含静态图 · 动态短片 · 背景音乐
          </span>
        </motion.div>

        <motion.div variants={itemVariants} className="grid grid-cols-2 gap-2">
          {/* 静态原图 — 标签左上角 */}
          <div className="relative aspect-[4/4] rounded-xl overflow-hidden bg-muted/40 group">
            <img
              src={buildMediaProxyUrl(currentLp.imageUrl, `live_cover_${selectedLiveIndex}.jpg`)}
              alt={`实况静态原图 ${selectedLiveIndex + 1}`}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              decoding="async"
            />
            <div className="absolute top-1.5 right-1.5 glass rounded-full px-2 py-0.5 text-[10px]">
              静态原图
            </div>
            <div className="absolute top-1.5 left-1.5 glass rounded-full px-1.5 py-0.5 text-[8px] font-medium flex items-center gap-0.5 bg-purple-500/20 border border-purple-400/30">
              <LivePhotoIcon size={8} className="text-purple-400" />#
              {(currentLp.index ?? selectedLiveIndex) + 1}
            </div>
          </div>
          {/* 动态短片 — 液态玻璃控件，标签右上角 */}
          <div className="relative aspect-[4/4] rounded-xl overflow-hidden bg-muted/40">
            {currentLp.videoUrl ? (
              <>
                <GlassVideoControls
                  src={buildStreamUrl(currentLp.videoUrl)}
                  poster={buildMediaProxyUrl(
                    currentLp.imageUrl,
                    `live_poster_${selectedLiveIndex}.jpg`
                  )}
                  muted
                  loop
                />
                <div className="absolute top-1.5 right-1.5 glass rounded-full px-2 py-0.5 text-[10px] z-30">
                  动态短片
                </div>
              </>
            ) : (
              <div className="h-full w-full flex items-center justify-center">
                <div className="text-center">
                  <Video className="h-8 w-8 mx-auto text-muted-foreground/40 mb-1" />
                  <p className="text-[10px] text-muted-foreground">无动态短片</p>
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {hasMultipleLive && totalLive > 2 && (
          <motion.div variants={itemVariants} className="flex gap-1.5 overflow-x-auto pb-1 pt-0.5">
            {livePhotos.map((lp, i) => (
              <button
                key={i}
                onClick={() => onSelectIndex(i)}
                className={cn(
                  "relative h-10 w-10 rounded-xl overflow-hidden flex-shrink-0 transition-all duration-200",
                  i === selectedLiveIndex
                    ? "ring-[1.5px] ring-purple-400 shadow-md shadow-purple-400/25"
                    : "ring-1 ring-black/10 dark:ring-white/15 opacity-55 hover:opacity-90 hover:scale-105 hover:ring-purple-400/50 dark:hover:ring-purple-300/40"
                )}
              >
                <img
                  src={buildMediaProxyUrl(lp.imageUrl, `thumb_lp_${i}.jpg`)}
                  alt={`实况 ${i + 1}`}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
                {i === selectedLiveIndex && <div className="absolute inset-0 bg-purple-400/20" />}
              </button>
            ))}
          </motion.div>
        )}

        {video.musicUrl ? (
          <motion.div variants={itemVariants}>
            <GlassAudioControls
              src={buildStreamUrl(video.musicUrl)}
              showLabel={false}
              className="w-full"
            />
          </motion.div>
        ) : (
          <motion.div variants={itemVariants}>
            <button
              onClick={onDownloadMixedMusic}
              disabled={musicState === "downloading"}
              className="w-full flex items-center gap-2 glass rounded-xl px-3 py-2 border border-dashed border-purple-400/30 hover:border-purple-400/60 transition-colors disabled:opacity-60"
            >
              {musicState === "downloading" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
                  <span className="text-xs text-muted-foreground">正在获取背景音乐...</span>
                </>
              ) : musicState === "done" ? (
                <>
                  <Check className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs text-emerald-600">背景音乐已获取，可在上方播放</span>
                </>
              ) : (
                <>
                  <Music className="h-4 w-4 text-purple-400/60" />
                  <span className="text-xs text-muted-foreground">点击获取原帖背景音乐</span>
                </>
              )}
            </button>
          </motion.div>
        )}

        <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <motion.button
            onClick={onDownloadSelectedImage}
            disabled={imageState === "downloading"}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="glass rounded-xl py-2 text-xs font-medium flex items-center justify-center gap-1 hover:bg-primary/10 transition-colors disabled:opacity-50"
          >
            {imageState === "downloading" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                下载中
              </>
            ) : imageState === "done" ? (
              <>
                <Check className="h-3.5 w-3.5" />
                已下载
              </>
            ) : (
              <>
                <ImageIcon className="h-3.5 w-3.5" />
                静态原图
              </>
            )}
          </motion.button>

          <motion.button
            onClick={onDownloadSelectedVideo}
            disabled={videoState === "downloading" || !currentLp?.videoUrl}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="glass rounded-xl py-2 text-xs font-medium flex items-center justify-center gap-1 hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={!currentLp?.videoUrl ? "该实况无动态短片" : ""}
          >
            {videoState === "downloading" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                下载中
              </>
            ) : videoState === "done" ? (
              <>
                <Check className="h-3.5 w-3.5" />
                已下载
              </>
            ) : (
              <>
                <Video className="h-3.5 w-3.5" />
                动态短片
              </>
            )}
          </motion.button>

          <motion.button
            onClick={onDownloadMixedMusic}
            disabled={musicState === "downloading"}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={cn(
              "glass rounded-xl py-2 text-xs font-medium flex items-center justify-center gap-1 hover:bg-primary/10 transition-colors",
              !video.musicUrl ? "border border-dashed border-purple-400/40" : "",
              "disabled:opacity-60"
            )}
            title={!video.musicUrl ? "尝试从原帖获取背景音乐" : "下载背景音乐"}
          >
            {musicState === "downloading" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                获取中
              </>
            ) : musicState === "done" ? (
              <>
                <Check className="h-3.5 w-3.5" />
                已下载
              </>
            ) : (
              <>
                <Music className="h-3.5 w-3.5" />
                {video.musicUrl ? "背景音乐" : "获取音乐"}
              </>
            )}
          </motion.button>
        </motion.div>

        <motion.div variants={itemVariants}>
          <button
            onClick={onOpenComposeModal}
            disabled={composeState === "downloading"}
            className="w-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl py-2.5 text-xs font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Film className="h-3.5 w-3.5" />
            合成完整视频（静态图 + 实况 + BGM）
          </button>
        </motion.div>

        {totalLive > 1 && (
          <motion.div variants={itemVariants}>
            <div className="overflow-hidden">
              <button
                type="button"
                onClick={onToggleBatch}
                className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 outline-none"
              >
                <ChevronRight
                  className={cn(
                    "h-3 w-3 transition-transform duration-300 ease-out",
                    batchOpen && "rotate-90"
                  )}
                />
                批量下载全部 {totalLive} 张实况资源
              </button>
              <motion.div
                initial={false}
                animate={{ height: batchOpen ? "auto" : 0, opacity: batchOpen ? 1 : 0 }}
                transition={{
                  duration: reduce ? 0.2 : 0.35,
                  ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
                }}
                className="overflow-hidden"
              >
                <motion.div
                  variants={batchContainerVariants}
                  initial="hidden"
                  animate={batchOpen ? "show" : "hidden"}
                  className="grid grid-cols-3 gap-1.5 mt-2 pl-4"
                >
                  <motion.button
                    variants={batchButtonVariants}
                    onClick={onDownloadLiveImages}
                    disabled={imageState === "downloading"}
                    whileHover={{ scale: 1.01 }}
                    className="glass rounded-lg py-1.5 text-[10px] font-medium flex items-center justify-center gap-1 hover:bg-primary/10 transition-colors disabled:opacity-50"
                  >
                    <ImageIcon className="h-3 w-3" /> 全部原图
                  </motion.button>
                  <motion.button
                    variants={batchButtonVariants}
                    onClick={onDownloadLiveVideos}
                    disabled={videoState === "downloading"}
                    whileHover={{ scale: 1.01 }}
                    className="glass rounded-lg py-1.5 text-[10px] font-medium flex items-center justify-center gap-1 hover:bg-primary/10 transition-colors disabled:opacity-50"
                  >
                    <Video className="h-3 w-3" /> 全部短片
                  </motion.button>
                  <motion.button
                    variants={batchButtonVariants}
                    onClick={onComposeMixedLive}
                    disabled={composeState === "downloading"}
                    whileHover={{ scale: 1.01 }}
                    className="glass rounded-lg py-1.5 text-[10px] font-medium flex items-center justify-center gap-1 hover:bg-primary/10 transition-colors disabled:opacity-50"
                  >
                    <Film className="h-3 w-3" /> 快速合并
                  </motion.button>
                </motion.div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}
