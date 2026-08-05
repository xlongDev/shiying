"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Film,
  Video,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Check,
} from "lucide-react";
import { LivePhotoIcon } from "@/components/live-photo-icon";
import { DownloadButton } from "@/components/download-button";
import { GlassVideoControls } from "@/components/glass-video-controls";
import { cn } from "@/lib/utils";
import { buildMediaProxyUrl, buildStreamUrl } from "@/lib/media-url";
import { useAppleLivePhoto } from "@/hooks/use-apple-live-photo";
import type { LivePhotoInfo } from "@/lib/parser";
import type { DownloadState } from "@/hooks/use-media-downloader";

interface MixedLivePhotoCardProps {
  livePhotos: LivePhotoInfo[];
  selectedLiveIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onSelectIndex: (i: number) => void;
  batchOpen: boolean;
  onToggleBatch: () => void;
  imageState: DownloadState;
  videoState: DownloadState;
  composeState: DownloadState;
  onDownloadSelectedImage: () => void;
  onDownloadSelectedVideo: () => void;
  onOpenComposeModal: () => void;
  onDownloadLiveImages: () => void;
  onDownloadLiveVideos: () => void;
  onComposeMixedLive: () => void;
}

/**
 * 混合实况照片预览与下载卡片（支持多实况切换、批量下载）。
 */
export function MixedLivePhotoCard({
  livePhotos,
  selectedLiveIndex,
  onPrev,
  onNext,
  onSelectIndex,
  batchOpen,
  onToggleBatch,
  imageState,
  videoState,
  composeState,
  onDownloadSelectedImage,
  onDownloadSelectedVideo,
  onOpenComposeModal,
  onDownloadLiveImages,
  onDownloadLiveVideos,
  onComposeMixedLive,
}: MixedLivePhotoCardProps) {
  const reduce = useReducedMotion();
  const slideY = reduce ? 0 : 12;
  const exitY = reduce ? 0 : -8;

  const {
    state: appleState,
    error: appleError,
    create: createApple,
    createBatch: createAppleBatch,
    batchProgress,
  } = useAppleLivePhoto();

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
            含静态图 · 动态短片 · 原声
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

        <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
        </motion.div>

        <motion.div variants={itemVariants}>
          <button
            onClick={onOpenComposeModal}
            disabled={composeState === "downloading"}
            title="将静态图 + 实况短片 + 背景音乐 (BGM) 合成为完整视频"
            className="w-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl py-2.5 text-xs font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Film className="h-3.5 w-3.5" />
            合成实况视频
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
                  className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-2 pl-4"
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
                  <button
                    onClick={() => createAppleBatch(livePhotos, "live_photo")}
                    disabled={appleState === "preparing" || appleState === "downloading"}
                    className="glass rounded-lg py-1.5 text-[10px] font-medium flex items-center justify-center gap-1 hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="把全部实况照片打包成苹果 Live Photo（.pvt）"
                  >
                    {appleState === "preparing" || appleState === "downloading" ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span className="text-xs">
                          {batchProgress
                            ? `实况 ${batchProgress.current}/${batchProgress.total}`
                            : "打包中"}
                        </span>
                      </>
                    ) : appleState === "done" ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="text-xs text-emerald-600">已保存</span>
                      </>
                    ) : (
                      <>
                        <LivePhotoIcon size={12} />
                        <span className="text-xs">全部实况</span>
                      </>
                    )}
                  </button>
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

        <motion.div variants={itemVariants} className="space-y-2">
          <motion.button
            onClick={() => createApple(currentLp)}
            disabled={!currentLp || appleState === "preparing" || appleState === "downloading"}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full rounded-xl py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white disabled:opacity-60 transition-transform"
          >
            {appleState === "preparing" || appleState === "downloading" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                打包中...
              </>
            ) : appleState === "done" ? (
              <>
                <Check className="h-3.5 w-3.5" />
                已保存
              </>
            ) : (
              <>
                <LivePhotoIcon size={14} />
                保存为苹果实况照片
              </>
            )}
          </motion.button>
          {appleState === "error" && appleError && (
            <p className="text-[11px] text-red-500/90">{appleError}</p>
          )}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
