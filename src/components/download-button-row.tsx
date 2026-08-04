"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Download,
  Check,
  Loader2,
  Music,
  Image as ImageIcon,
  Archive,
  Film,
  Play,
  ExternalLink,
  Copy,
} from "lucide-react";
import { useSound } from "@/components/sound-manager";
import { GlassAudioControls } from "@/components/glass-audio-controls";
import type { DownloadStatus } from "@/hooks/use-media-downloader";

interface DownloadButtonRowProps {
  hasVideo: boolean;
  isImagePost: boolean;
  hasImages: boolean;
  hasMusic: boolean;
  isLivePhoto: boolean;
  isMixedLivePhoto: boolean;
  isLivePhotoPending: boolean;
  selectedCount: number;
  totalImages: number;
  musicPreviewSrc?: string | null;
  video: DownloadStatus;
  music: DownloadStatus;
  images: DownloadStatus;
  zip: DownloadStatus;
  onDownloadVideo: () => void;
  onDownloadMusic: () => void;
  onDownloadImages: () => void;
  onDownloadZip: () => void;
  onOpenCompose: () => void;
  onPreviewVideo: () => void;
  onPreviewImages: () => void;
  onCopyLink: () => void;
}

/**
 * 主结果卡片底部的下载 / 操作按钮区：
 * 视频、原声音乐、图片、ZIP、合成视频、预览、复制链接。
 * 所有下载状态来自 useMediaDownloader 的统一状态机。
 */
export function DownloadButtonRow({
  hasVideo,
  isImagePost,
  hasImages,
  hasMusic,
  isLivePhoto,
  isMixedLivePhoto,
  isLivePhotoPending,
  selectedCount,
  totalImages,
  musicPreviewSrc,
  video,
  music,
  images,
  zip,
  onDownloadVideo,
  onDownloadMusic,
  onDownloadImages,
  onDownloadZip,
  onOpenCompose,
  onPreviewVideo,
  onPreviewImages,
  onCopyLink,
}: DownloadButtonRowProps) {
  const { play } = useSound();

  return (
    <div className="mt-auto space-y-2.5">
      {/* 视频下载 — 只有非图文帖子且有视频 URL 时才显示 */}
      {hasVideo && !isImagePost && (
        <motion.button
          onClick={onDownloadVideo}
          disabled={video.state === "downloading"}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full btn-liquid rounded-2xl py-3 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {video.state === "downloading" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{video.progress > 0 ? `${video.progress}%` : "下载中"}</span>
            </>
          ) : video.state === "done" ? (
            <>
              <Check className="h-4 w-4" />
              <span>视频已下载</span>
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              <span>下载视频</span>
            </>
          )}
        </motion.button>
      )}

      {/* 音乐预览 + 下载 — 非实况帖/非混合实况帖时显示 */}
      {hasMusic && !isLivePhoto && !isMixedLivePhoto && !isLivePhotoPending && (
        <div className="space-y-2">
          {musicPreviewSrc && (
            <GlassAudioControls src={musicPreviewSrc} showLabel={false} className="w-full" />
          )}
          <motion.button
            onClick={onDownloadMusic}
            disabled={music.state === "downloading"}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="relative w-full glass rounded-2xl py-2.5 text-sm font-medium flex items-center justify-center gap-2 hover:bg-primary/10 transition-colors disabled:opacity-60 overflow-hidden"
          >
            {music.state === "downloading" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>{music.progress > 0 ? `下载中 ${music.progress}%` : "下载中..."}</span>
                {music.progress > 0 && (
                  <div
                    className="absolute bottom-0 left-0 h-0.5 bg-primary transition-all duration-200"
                    style={{ width: `${music.progress}%` }}
                  />
                )}
              </>
            ) : music.state === "done" ? (
              <>
                <Check className="h-4 w-4" />
                <span>音乐已下载</span>
              </>
            ) : (
              <>
                <Music className="h-4 w-4" />
                <span>下载原声音乐</span>
              </>
            )}
          </motion.button>
        </div>
      )}

      {/* 图片下载 — 普通图文帖和混合实况帖显示，单图实况隐藏 */}
      {hasImages && !isLivePhoto && !isLivePhotoPending && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <motion.button
              onClick={onDownloadImages}
              disabled={images.state === "downloading" || selectedCount === 0}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="glass rounded-2xl py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-primary/10 transition-colors disabled:opacity-60"
            >
              {images.state === "downloading" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{images.total > 0 ? `${images.progress}/${images.total}` : "下载中"}</span>
                </>
              ) : images.state === "done" ? (
                <>
                  <Check className="h-4 w-4" />
                  <span>已下载</span>
                </>
              ) : (
                <>
                  <ImageIcon className="h-4 w-4" />
                  <span>
                    下载选中 ({selectedCount}/{totalImages})
                  </span>
                </>
              )}
            </motion.button>
            <motion.button
              onClick={onDownloadZip}
              disabled={zip.state === "downloading" || selectedCount === 0}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="glass rounded-2xl py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-primary/10 transition-colors disabled:opacity-60"
            >
              {zip.state === "downloading" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{zip.progress > 0 ? `${zip.progress}%` : "打包中"}</span>
                </>
              ) : zip.state === "done" ? (
                <>
                  <Check className="h-4 w-4" />
                  <span>已打包</span>
                </>
              ) : (
                <>
                  <Archive className="h-4 w-4" />
                  <span>打包 ZIP</span>
                </>
              )}
            </motion.button>
          </div>
        </>
      )}

      {/* 合成视频按钮 — 图文帖专属（非实况、非混合实况）：图片+音乐合成 MP4 */}
      {isImagePost && hasImages && !isLivePhoto && !isMixedLivePhoto && !isLivePhotoPending && (
        <motion.button
          onClick={() => {
            play("click");
            onOpenCompose();
          }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full glass rounded-2xl py-2.5 text-sm font-medium flex items-center justify-center gap-2 hover:bg-primary/10 transition-colors"
        >
          <Film className="h-4 w-4" />
          <span>合成图文视频</span>
        </motion.button>
      )}

      {/* 预览 + 复制链接 — 底部操作栏 */}
      <div className="flex gap-2">
        {/* 视频预览 — 普通视频帖子 */}
        {hasVideo && !isImagePost && (
          <motion.button
            onClick={() => {
              play("click");
              onPreviewVideo();
            }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="flex-1 glass rounded-2xl py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-primary/10 transition-colors"
          >
            <Play className="h-4 w-4" />
            <span className="hidden sm:inline">预览视频</span>
          </motion.button>
        )}
        {/* 图片预览 — 图文帖（含混合实况、单图实况） */}
        {(isImagePost || isMixedLivePhoto || isLivePhoto) && hasImages && !isLivePhotoPending && (
          <motion.button
            onClick={() => {
              play("click");
              onPreviewImages();
            }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="flex-1 glass rounded-2xl py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-primary/10 transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="hidden sm:inline">
              {isMixedLivePhoto ? "预览大图" : isLivePhoto ? "预览原图" : "预览图片"}
            </span>
          </motion.button>
        )}

        {/* 复制链接 — 所有模式均分宽度 */}
        <motion.button
          onClick={onCopyLink}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="flex-1 glass rounded-2xl py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-primary/10 transition-colors"
        >
          <Copy className="h-4 w-4" />
          <span className="hidden sm:inline">复制链接</span>
        </motion.button>
      </div>
    </div>
  );
}
