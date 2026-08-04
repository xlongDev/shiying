"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { EASE_EXPO } from "@/lib/motion";
import { Heart, MessageCircle, Share2, Image as ImageIcon, Clock } from "lucide-react";
import { useSound } from "@/components/sound-manager";
import { toast } from "sonner";
import type { ParsedVideo } from "@/lib/parser";

/**
 * 图文视频合成弹窗按需加载：其内部链路（useComposeVideo → @/lib/ffmpeg-compose → @ffmpeg/util）
 * 体积较重，通过 next/dynamic 拆为独立异步 chunk，避免打进首屏主包。
 * 该组件仅由客户端组件渲染且依赖浏览器 API，故 ssr:false。
 */
const ComposeVideoModal = dynamic(
  () => import("@/components/compose-video-modal").then((m) => m.ComposeVideoModal),
  { ssr: false, loading: () => null }
);
import { LivePhotoIcon } from "@/components/live-photo-icon";
import {
  buildMediaProxyUrl,
  buildProxyUrl,
  buildExtractAudioUrl,
  sanitizeFilename,
  formatCount,
  formatDuration,
} from "@/lib/media-url";
import { LivePhotoPanel } from "@/components/live-photo-panel";
import { ImageSelectionGrid } from "@/components/image-selection-grid";
import { VideoPreviewModal } from "@/components/video-preview-modal";
import { ImageViewerModal } from "@/components/image-viewer-modal";
import { DownloadButtonRow } from "@/components/download-button-row";
import { useMediaDownloader } from "@/hooks/use-media-downloader";
import { useImageSelection } from "@/hooks/use-image-selection";
import { useResultModals } from "@/hooks/use-result-modals";

interface VideoResultProps {
  video: ParsedVideo;
  /** 实况照片探测失败后重试（重新调用 /api/parse-live-photo） */
  onRetryLivePhoto?: () => void;
}

export function VideoResult({ video, onRetryLivePhoto }: VideoResultProps) {
  const { play } = useSound();
  const downloader = useMediaDownloader();
  const selection = useImageSelection();
  const modals = useResultModals();

  React.useEffect(() => {
    play("detect");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.awemeId]);

  // 默认全选图片
  React.useEffect(() => {
    if (video.images && video.images.length > 0) {
      selection.setSelected(new Set(video.images.map((_, i) => i)));
    }
  }, [video.images, selection.setSelected]);

  const hasVideo = !!video.videoUrl;
  const hasImages = !!video.images && video.images.length > 0;
  const isImagePost = !!video.isImagePost;
  const hasMusic = !!video.hasMusic;
  const isLivePhoto = !!video.isLivePhoto && !!video.livePhoto;
  const isMixedLivePhoto =
    !!video.isMixedLivePhoto && !!video.livePhotos && video.livePhotos.length > 0;
  const isLivePhotoPending = !!video.livePhotoPending;
  const livePhotos = video.livePhotos;

  /** 计算音乐下载 URL（与原始逻辑一致：musicUrl / 图文 / 提取音频 三分支） */
  const buildMusicDownloadUrl = React.useCallback((): string | null => {
    const filename = `${sanitizeFilename(video.desc)}_原声.m4a`;
    let downloadUrl = "";
    if (video.musicUrl) {
      downloadUrl = buildMediaProxyUrl(video.musicUrl, filename);
    } else if (isImagePost) {
      downloadUrl = `/api/download-music?awemeId=${encodeURIComponent(video.awemeId)}&filename=${encodeURIComponent(filename)}`;
    } else {
      const videoSrc = video.videoUrlPlay || video.videoUrl;
      if (videoSrc) {
        downloadUrl = buildExtractAudioUrl(videoSrc, filename, video.awemeId);
      }
    }
    return downloadUrl || null;
  }, [video, isImagePost]);

  const handleDownloadVideo = React.useCallback(async () => {
    if (!video.videoUrl) return;
    const filename = `${sanitizeFilename(video.desc)}.mp4`;
    const proxyUrl = buildProxyUrl(video.videoUrl, filename);
    await downloader.downloadVideo(proxyUrl, filename);
  }, [video.videoUrl, video.desc, downloader]);

  const handleDownloadMusic = React.useCallback(async () => {
    const downloadUrl = buildMusicDownloadUrl();
    if (!downloadUrl) {
      toast.error("该视频没有可下载的音乐");
      play("error");
      return;
    }
    const filename = `${sanitizeFilename(video.desc)}_原声.m4a`;
    await downloader.downloadMusic(downloadUrl, filename);
  }, [buildMusicDownloadUrl, video.desc, downloader, play]);

  const handleDownloadImages = React.useCallback(async () => {
    if (!video.images) return;
    const selected = video.images.filter((_, i) => selection.selected.has(i));
    await downloader.downloadImages(selected, video.desc);
  }, [video.images, video.desc, selection.selected, downloader]);

  const handleDownloadZip = React.useCallback(async () => {
    if (!video.images) return;
    const selected = video.images.filter((_, i) => selection.selected.has(i));
    const zipName = `${sanitizeFilename(video.desc)}_images.zip`;
    await downloader.downloadZip(selected, zipName);
  }, [video.images, video.desc, selection.selected, downloader]);

  const handleCopyLink = React.useCallback(async () => {
    play("click");
    try {
      await navigator.clipboard.writeText(video.videoUrl || video.cover);
      toast.success("链接已复制");
    } catch {
      toast.error("复制失败");
    }
  }, [video.videoUrl, video.cover, play]);

  const toggleImageSelect = (i: number) => {
    play("click");
    selection.toggle(i);
  };
  const toggleAllImages = () => {
    play("click");
    selection.toggleAll(video.images?.length || 0);
  };

  const selectedCount = selection.selectedCount;
  const totalImages = video.images?.length || 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.5, ease: EASE_EXPO }}
      className="w-full"
    >
      <div className="glass-strong rounded-[2rem] p-4 sm:p-6 overflow-hidden">
        <div className="flex flex-col md:flex-row gap-5">
          {/* 封面 */}
          <div className="relative md:w-[280px] flex-shrink-0">
            <div className="relative aspect-[9/16] rounded-3xl overflow-hidden bg-muted/40">
              {video.cover ? (
                <img
                  src={buildMediaProxyUrl(video.cover, "cover.jpg")}
                  alt={video.desc}
                  className="h-full w-full object-cover"
                  decoding="async"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center">
                  <ImageIcon className="h-12 w-12 text-muted-foreground/50" />
                </div>
              )}

              {/* 图文标签 — 左上角 */}
              {(isImagePost || isLivePhoto || isMixedLivePhoto) && (
                <div className="absolute top-3 left-3 flex gap-1.5">
                  {isImagePost && !isLivePhoto && !isMixedLivePhoto && (
                    <div className="glass rounded-full px-3 py-1 text-xs font-medium flex items-center gap-1">
                      <ImageIcon className="h-3 w-3" />
                      图文
                    </div>
                  )}
                  {(isLivePhoto || isMixedLivePhoto) && (
                    <div className="glass rounded-full px-3 py-1 text-xs font-medium flex items-center gap-1 bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-400/30">
                      <LivePhotoIcon size={12} className="text-purple-400" />
                      {isMixedLivePhoto ? "混合实况" : "实况"}
                    </div>
                  )}
                </div>
              )}

              {/* 时长 / 图片张数 */}
              {video.duration ? (
                <div className="absolute bottom-3 right-3 glass rounded-full px-2.5 py-1 text-xs font-medium flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDuration(video.duration)}
                </div>
              ) : null}
              {hasImages && (
                <div className="absolute bottom-3 left-3 glass rounded-full px-2.5 py-1 text-xs font-medium flex items-center gap-1">
                  <ImageIcon className="h-3 w-3" />
                  {totalImages} 张
                </div>
              )}
            </div>
          </div>

          {/* 信息 */}
          <div className="flex-1 flex flex-col gap-4 min-w-0">
            {/* 作者 */}
            <div className="flex items-center gap-3">
              {video.author.avatar ? (
                <img
                  src={buildMediaProxyUrl(video.author.avatar, "avatar.jpg")}
                  alt={video.author.name}
                  className="h-10 w-10 rounded-full object-cover flex-shrink-0"
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="h-10 w-10 rounded-full bg-muted/40 flex-shrink-0" />
              )}
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{video.author.name}</p>
                <p className="text-xs text-muted-foreground">抖音</p>
              </div>
            </div>

            {/* 描述 */}
            {video.desc && <p className="text-sm leading-relaxed line-clamp-3">{video.desc}</p>}

            {/* 统计 */}
            <div className="flex gap-4 text-xs text-muted-foreground">
              {video.stats?.likeCount !== undefined && (
                <span className="flex items-center gap-1">
                  <Heart className="h-3.5 w-3.5" />
                  {formatCount(video.stats.likeCount)}
                </span>
              )}
              {video.stats?.commentCount !== undefined && (
                <span className="flex items-center gap-1">
                  <MessageCircle className="h-3.5 w-3.5" />
                  {formatCount(video.stats.commentCount)}
                </span>
              )}
              {video.stats?.shareCount !== undefined && (
                <span className="flex items-center gap-1">
                  <Share2 className="h-3.5 w-3.5" />
                  {formatCount(video.stats.shareCount)}
                </span>
              )}
            </div>

            {/* 图片选择网格 — 单图实况隐藏；混合实况和普通图文均显示 */}
            {hasImages && !isLivePhoto && (
              <ImageSelectionGrid
                images={video.images || []}
                selected={selection.selected}
                isSelected={selection.isSelected}
                onToggle={toggleImageSelect}
                onToggleAll={toggleAllImages}
                selectedCount={selectedCount}
                totalImages={totalImages}
                isMixedLivePhoto={isMixedLivePhoto}
                livePhotos={livePhotos}
                isLivePhotoPending={isLivePhotoPending}
                onOpenViewer={(i) => modals.openViewer(i)}
              />
            )}

            {/* 下载按钮区 */}
            <DownloadButtonRow
              hasVideo={hasVideo}
              isImagePost={isImagePost}
              hasImages={hasImages}
              hasMusic={hasMusic}
              isLivePhoto={isLivePhoto}
              isMixedLivePhoto={isMixedLivePhoto}
              isLivePhotoPending={isLivePhotoPending}
              selectedCount={selectedCount}
              totalImages={totalImages}
              video={downloader.video}
              music={downloader.music}
              images={downloader.images}
              zip={downloader.zip}
              onDownloadVideo={handleDownloadVideo}
              onDownloadMusic={handleDownloadMusic}
              onDownloadImages={handleDownloadImages}
              onDownloadZip={handleDownloadZip}
              onOpenCompose={modals.openComposeModal}
              onPreviewVideo={modals.openVideoPreview}
              onPreviewImages={() => modals.openViewer(0)}
              onCopyLink={handleCopyLink}
            />

            {/* 实况照片面板（含探测骨架屏 / 重试 / 单图 / 混合实况 UI） */}
            <LivePhotoPanel
              video={video}
              onOpenComposeModal={modals.openComposeModal}
              onRetryLivePhoto={onRetryLivePhoto}
            />
          </div>
        </div>
      </div>

      {/* 视频预览弹窗 */}
      <AnimatePresence>
        {modals.showVideoPreview && hasVideo && !isImagePost && (
          <VideoPreviewModal
            videoUrl={video.videoUrl}
            cover={video.cover}
            title={video.desc}
            onClose={modals.closeVideoPreview}
          />
        )}
      </AnimatePresence>

      {/* 图片浏览器 */}
      <AnimatePresence>
        {modals.viewerIndex !== null && video.images && (
          <ImageViewerModal
            images={video.images}
            initialIndex={modals.viewerIndex}
            onClose={modals.closeViewer}
          />
        )}
      </AnimatePresence>

      {/* 图文视频合成弹窗 */}
      <ComposeVideoModal
        open={modals.showComposeModal}
        onClose={modals.closeComposeModal}
        images={video.images || []}
        musicUrl={video.musicUrl || null}
        duration={video.duration || 0}
        title={video.desc}
        livePhotos={
          isMixedLivePhoto && livePhotos
            ? livePhotos
                .filter((lp) => lp.videoUrl)
                .map((lp) => ({
                  index: lp.index ?? 0,
                  videoUrl: lp.videoUrl!,
                }))
            : undefined
        }
        awemeId={video.awemeId}
      />
    </motion.div>
  );
}
