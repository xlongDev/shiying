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
import { cn } from "@/lib/utils";
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
  /** 音乐元信息（歌名/作者/封面）；汽水音乐可解析出真实歌名-作者 */
  musicMeta?: { title: string; author: string; cover?: string; isOriginalSound?: boolean } | null;
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
  musicMeta,
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
  const isRegularImagePost =
    isImagePost && hasImages && !isLivePhoto && !isMixedLivePhoto && !isLivePhotoPending;

  return (
    <div className="mt-auto space-y-2.5">
      {/* 主操作：固定 2 列；普通视频只保留 [预览视频][复制链接] */}
      <div className="grid grid-cols-2 gap-2">
        {/* 视频预览 — 仅非图文帖 */}
        {hasVideo && !isImagePost && (
          <motion.button
            onClick={() => {
              play("click");
              onPreviewVideo();
            }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="glass rounded-2xl py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-primary/10 transition-colors"
          >
            <Play className="h-4 w-4" />
            <span>预览视频</span>
          </motion.button>
        )}

        {/* 图片下载 — 普通图文帖 / 混合实况帖；单图实况隐藏 */}
        {hasImages && !isLivePhoto && !isLivePhotoPending && (
          <motion.button
            onClick={onDownloadImages}
            disabled={images.state === "downloading" || selectedCount === 0}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={cn(
              "rounded-2xl py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60",
              selectedCount > 0
                ? "glass bg-primary/10 ring-1 ring-primary/40"
                : "glass hover:bg-primary/10"
            )}
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
        )}

        {/* 打包下载（选中图片合成 ZIP） */}
        {hasImages && !isLivePhoto && !isLivePhotoPending && (
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
                <span>打包下载</span>
              </>
            )}
          </motion.button>
        )}

        {/* 预览图片 — 图文帖（含混合实况、单图实况） */}
        {(isImagePost || isMixedLivePhoto || isLivePhoto) && hasImages && !isLivePhotoPending && (
          <motion.button
            onClick={() => {
              play("click");
              onPreviewImages();
            }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="glass rounded-2xl py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-primary/10 transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
            <span>{isMixedLivePhoto ? "预览大图" : isLivePhoto ? "预览原图" : "预览图片"}</span>
          </motion.button>
        )}

        {/* 复制链接 — 放入主操作区，与下载/预览同级 */}
        <motion.button
          onClick={() => {
            play("click");
            onCopyLink();
          }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="glass rounded-2xl py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 hover:bg-primary/10 transition-colors"
        >
          <Copy className="h-4 w-4" />
          <span>复制链接</span>
        </motion.button>
      </div>

      {/* 音乐：独立区块（歌曲信息 + 预览 + 下载）。单实况/混合实况同样可拥有 BGM */}
      {hasMusic && !isLivePhotoPending && (
        <div className="space-y-2">
          {/* 歌曲信息条：封面 + 歌名 - 作者（汽水音乐显示真实歌名，原声显示原声名） */}
          {musicMeta && (
            <div className="flex items-center gap-2.5 rounded-2xl glass px-3 py-2">
              {musicMeta.cover && (
                // 外部 CDN 封面，用原生 img 避免 next/image 域名配置；lazy 加载
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={musicMeta.cover}
                  alt=""
                  loading="lazy"
                  className="h-9 w-9 rounded-lg object-cover shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate flex items-center gap-1">
                  <Music className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="truncate">{musicMeta.title}</span>
                </p>
                {musicMeta.author && (
                  <p className="text-xs text-muted-foreground truncate">-{musicMeta.author}</p>
                )}
              </div>
            </div>
          )}
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

      {/* 普通视频：下载视频放在下载音乐按钮下方，作为底部全宽主操作 */}
      {hasVideo && !isImagePost && (
        <motion.button
          onClick={onDownloadVideo}
          disabled={video.state === "downloading"}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full btn-liquid rounded-2xl py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-60"
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

      {/* 合成图文视频 — 普通图文帖专属，作为底部全宽主操作（与复制链接互换位置） */}
      {isRegularImagePost && (
        <motion.button
          onClick={() => {
            play("click");
            onOpenCompose();
          }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full btn-liquid rounded-2xl py-2.5 text-sm font-medium flex items-center justify-center gap-1.5"
        >
          <Film className="h-4 w-4" />
          <span>合成图文视频</span>
        </motion.button>
      )}
    </div>
  );
}
