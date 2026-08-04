"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Music, Video, Image as ImageIcon, Loader2, Eye, Download } from "lucide-react";
import { LivePhotoIcon } from "@/components/live-photo-icon";
import { GlassVideoControls } from "@/components/glass-video-controls";
import { GlassAudioControls } from "@/components/glass-audio-controls";
import { buildMediaProxyUrl, buildStreamUrl } from "@/lib/media-url";
import type { LivePhotoInfo } from "@/lib/parser";
import type { DownloadState } from "@/hooks/use-media-downloader";

interface SingleLivePhotoCardProps {
  lp: LivePhotoInfo;
  imageState: DownloadState;
  videoState: DownloadState;
  musicState: DownloadState;
  composeState: DownloadState;
  onDownloadImage: () => void;
  onDownloadVideo: () => void;
  onDownloadMusic: () => void;
  onPreviewCompose: () => void;
  onComposeLive: () => void;
}

/**
 * 单图实况照片预览与下载卡片。
 */
export function SingleLivePhotoCard({
  lp,
  imageState,
  videoState,
  musicState,
  composeState,
  onDownloadImage,
  onDownloadVideo,
  onDownloadMusic,
  onPreviewCompose,
  onComposeLive,
}: SingleLivePhotoCardProps) {
  const reduce = useReducedMotion();
  const containerVariants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
  };
  const itemVariants = {
    hidden: { opacity: 0, y: reduce ? 0 : 12 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
    },
  };

  return (
    <motion.div
      key="single-live"
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
      }}
      exit={{
        opacity: 0,
        y: -8,
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
            1 张
          </span>
          <span className="text-[10px] text-muted-foreground ml-auto">
            含静态图 · 动态短片 · 背景音乐
          </span>
        </motion.div>

        <motion.div variants={itemVariants} className="grid grid-cols-2 gap-2">
          {/* 静态原图 — 标签移至左上角 */}
          <div className="relative aspect-[4/4] rounded-xl overflow-hidden bg-muted/40">
            <img
              src={buildMediaProxyUrl(lp.imageUrl, "live_cover.jpg")}
              alt="实况静态原图"
              className="absolute inset-0 w-full h-full object-cover"
              decoding="async"
            />
            <div className="absolute top-1.5 right-1.5 glass rounded-full px-2 py-0.5 text-[10px]">
              静态原图
            </div>
          </div>
          {/* 动态短片 — 液态玻璃自定义控件，标签右上角 */}
          <div className="relative aspect-[4/4] rounded-xl overflow-hidden bg-muted/40">
            <GlassVideoControls
              src={buildStreamUrl(lp.videoUrl)}
              poster={buildMediaProxyUrl(lp.imageUrl, "live_poster.jpg")}
              muted
              loop
            />
            <div className="absolute top-1.5 right-1.5 glass rounded-full px-2 py-0.5 text-[10px] z-30">
              动态短片
            </div>
          </div>
        </motion.div>

        {lp.musicUrl && (
          <motion.div variants={itemVariants}>
            <GlassAudioControls
              src={buildStreamUrl(lp.musicUrl)}
              showLabel={false}
              className="w-full"
            />
          </motion.div>
        )}

        <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <motion.button
            onClick={onDownloadImage}
            disabled={imageState === "downloading"}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="glass rounded-xl py-2 text-xs font-medium flex items-center justify-center gap-1 hover:bg-primary/10 transition-colors disabled:opacity-60"
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
            onClick={onDownloadVideo}
            disabled={videoState === "downloading"}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="glass rounded-xl py-2 text-xs font-medium flex items-center justify-center gap-1 hover:bg-primary/10 transition-colors disabled:opacity-60"
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
            onClick={onDownloadMusic}
            disabled={musicState === "downloading" || !lp.musicUrl}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="glass rounded-xl py-2 text-xs font-medium flex items-center justify-center gap-1 hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={!lp.musicUrl ? "该实况无背景音乐" : ""}
          >
            {musicState === "downloading" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                下载中
              </>
            ) : musicState === "done" ? (
              <>
                <Check className="h-3.5 w-3.5" />
                已下载
              </>
            ) : (
              <>
                <Music className="h-3.5 w-3.5" />
                背景音乐
              </>
            )}
          </motion.button>
        </motion.div>

        {lp.musicUrl && (
          <motion.div variants={itemVariants} className="grid grid-cols-2 gap-2">
            <motion.button
              onClick={onPreviewCompose}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="glass rounded-xl py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-primary/10 transition-colors"
            >
              <Eye className="h-3.5 w-3.5" />
              预览合成效果
            </motion.button>

            <motion.button
              onClick={onComposeLive}
              disabled={composeState === "downloading"}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl py-2.5 text-xs font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-60 transition-transform"
            >
              {composeState === "downloading" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  合成中...
                </>
              ) : composeState === "done" ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  已下载
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" />
                  下载合成视频
                </>
              )}
            </motion.button>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}
