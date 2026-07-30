"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Music, Film, Video, Image as ImageIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { LivePhotoIcon } from "@/components/live-photo-icon";
import { DownloadButton } from "@/components/download-button";
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
            <DownloadButton
              state={musicState}
              idleIcon={Music}
              label="点击获取原帖背景音乐"
              loadingLabel="正在获取背景音乐..."
              doneLabel="背景音乐已获取，可在上方播放"
              onClick={onDownloadMixedMusic}
              animated={false}
              className="w-full !py-2.5 !px-3 border border-dashed border-purple-400/30 hover:border-purple-400/60 disabled:opacity-60 text-xs"
            />
          </motion.div>
        )}

        <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <DownloadButton
            state={imageState}
            idleIcon={ImageIcon}
            label="静态原图"
            onClick={onDownloadSelectedImage}
          />

          <DownloadButton
            state={videoState}
            idleIcon={Video}
            label="动态短片"
            onClick={onDownloadSelectedVideo}
            disabled={!currentLp?.videoUrl}
            title={!currentLp?.videoUrl ? "该实况无动态短片" : undefined}
          />

          <DownloadButton
            state={musicState}
            idleIcon={Music}
            label={video.musicUrl ? "背景音乐" : "获取音乐"}
            loadingLabel="获取中"
            onClick={onDownloadMixedMusic}
            className={
              !video.musicUrl ? "border border-dashed border-purple-400/40 disabled:opacity-60" : ""
            }
            title={!video.musicUrl ? "尝试从原帖获取背景音乐" : "下载背景音乐"}
          />
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
                  <DownloadButton
                    state={imageState}
                    idleIcon={ImageIcon}
                    label="全部原图"
                    onClick={onDownloadLiveImages}
                    animated={false}
                    className="!py-1.5 text-[10px] rounded-lg"
                  />
                  <DownloadButton
                    state={videoState}
                    idleIcon={Video}
                    label="全部短片"
                    onClick={onDownloadLiveVideos}
                    animated={false}
                    className="!py-1.5 text-[10px] rounded-lg"
                  />
                  <DownloadButton
                    state={composeState}
                    idleIcon={Film}
                    label="快速合并"
                    onClick={onComposeMixedLive}
                    animated={false}
                    className="!py-1.5 text-[10px] rounded-lg"
                  />
                </motion.div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}
