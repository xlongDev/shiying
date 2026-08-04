"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ParsedVideo } from "@/lib/parser";
import {
  buildMediaProxyUrl,
  buildProxyUrl,
  sanitizeFilename,
  triggerBlobDownload,
} from "@/lib/media-url";
import { LivePhotoDetecting } from "@/components/live-photo-detecting";
import { LivePhotoFailed } from "@/components/live-photo-failed";
import { SingleLivePhotoCard } from "@/components/single-live-photo-card";
import { MixedLivePhotoCard } from "@/components/mixed-live-photo-card";
import { LiveComposePreviewModal } from "@/components/live-compose-preview-modal";
import { useLivePhotoViewState } from "@/hooks/use-live-photo-view-state";
import { useDownloadAction } from "@/hooks/use-download-action";

interface LivePhotoPanelProps {
  video: ParsedVideo;
  /** 打开「合成完整视频」模态框（由父组件持有 ComposeVideoModal） */
  onOpenComposeModal: () => void;
  /** 实况照片探测失败后重试（重新调用 /api/parse-live-photo） */
  onRetryLivePhoto?: () => void;
}

/**
 * 实况照片面板（编排器）：持有实况专用下载状态机与视图状态，
 * 按探测阶段渲染 LivePhotoDetecting / LivePhotoFailed /
 * SingleLivePhotoCard / MixedLivePhotoCard。
 */
export function LivePhotoPanel({
  video,
  onOpenComposeModal,
  onRetryLivePhoto,
}: LivePhotoPanelProps) {
  const view = useLivePhotoViewState();
  const [composePreviewOpen, setComposePreviewOpen] = React.useState(false);

  /* ---- 下载动作（每个独立状态机） ---- */
  const imageDownload = useDownloadAction();
  const videoDownload = useDownloadAction();
  const composeDownload = useDownloadAction();

  const isLivePhotoPending = !!video.livePhotoPending;
  const isLivePhoto = !!video.isLivePhoto && !!video.livePhoto;
  const isMixedLivePhoto =
    !!video.isMixedLivePhoto && !!video.livePhotos && video.livePhotos.length > 0;
  const lp = video.livePhoto;
  const livePhotos = video.livePhotos;

  const baseName = sanitizeFilename(video.desc);

  /* ----------------------------- 单图实况下载 ----------------------------- */

  const handleDownloadLiveImage = () => {
    if (!lp?.imageUrl) return;
    imageDownload.execute({
      url: buildMediaProxyUrl(lp.imageUrl, `${baseName}_实况原图.jpg`),
      filename: `${baseName}_实况原���.jpg`,
      successMessage: "实况原图下载完成",
    });
  };

  const handleDownloadLiveVideo = () => {
    if (!lp?.videoUrl) return;
    videoDownload.execute({
      url: buildProxyUrl(lp.videoUrl, `${baseName}_实况短片.mp4`),
      filename: `${baseName}_实况短片.mp4`,
      successMessage: "实况短片下载完成",
    });
  };

  const handleComposeLiveVideo = () => {
    if (!lp?.videoUrl) return;
    composeDownload.execute({
      url: `/api/live-compose?videoUrl=${encodeURIComponent(lp.videoUrl)}&audioUrl=${encodeURIComponent(lp.musicUrl ?? "")}&filename=${encodeURIComponent(`${baseName}_实况合成.mp4`)}`,
      filename: `${baseName}_实况合成.mp4`,
      successMessage: "实况合成视频下载完成",
      errorMessage: "合成失败",
      minBlobSize: 1000,
    });
  };

  const handlePreviewCompose = () => {
    if (!lp?.videoUrl) return;
    setComposePreviewOpen(true);
  };

  /* ----------------------------- 混合实况下载 ----------------------------- */

  const handleDownloadSelectedLiveImage = () => {
    if (!livePhotos || livePhotos.length === 0) return;
    const item = livePhotos[view.selectedLiveIndex];
    if (!item?.imageUrl) return;
    imageDownload.execute({
      url: buildMediaProxyUrl(
        item.imageUrl,
        `${baseName}_实况${view.selectedLiveIndex + 1}_原图.jpg`
      ),
      filename: `${baseName}_实况${view.selectedLiveIndex + 1}_原图.jpg`,
      successMessage: "实况原图下载完成",
    });
  };

  const handleDownloadSelectedLiveVideo = () => {
    if (!livePhotos || livePhotos.length === 0) return;
    const item = livePhotos[view.selectedLiveIndex];
    if (!item?.videoUrl) return;
    videoDownload.execute({
      url: buildProxyUrl(item.videoUrl, `${baseName}_实况${view.selectedLiveIndex + 1}_短片.mp4`),
      filename: `${baseName}_实况${view.selectedLiveIndex + 1}_短片.mp4`,
      successMessage: "实况短片下载完成",
    });
  };

  /** 批量下载全部实况原图 */
  const handleDownloadLiveImages = async () => {
    if (!livePhotos || livePhotos.length === 0) return;
    imageDownload.execute({
      url: "", // 占位：实际走自定义 fetchBlob
      filename: "",
      successMessage: `${livePhotos.length} 张实况原图下载完成`,
      fetchBlob: async () => {
        for (let i = 0; i < livePhotos.length; i++) {
          const item = livePhotos[i];
          const fn = `${baseName}_实况${i + 1}_原图.jpg`;
          const proxyUrl = buildMediaProxyUrl(item.imageUrl, fn);
          const res = await fetch(proxyUrl);
          if (!res.ok) throw new Error(`实况${i + 1}原图下载失败`);
          const blob = await res.blob();
          triggerBlobDownload(blob, fn);
          await new Promise((r) => setTimeout(r, 300));
        }
        return new Blob(); // 空 blob，仅触发成功流程
      },
      shouldStart: () => livePhotos.length > 0,
    });
  };

  /** 批量下载全部实况短片 */
  const handleDownloadLiveVideos = async () => {
    if (!livePhotos || livePhotos.length === 0) return;
    videoDownload.execute({
      url: "",
      filename: "",
      successMessage: `${livePhotos.filter((l) => l.videoUrl).length} 个实况短片下载完成`,
      fetchBlob: async () => {
        for (let i = 0; i < livePhotos.length; i++) {
          const item = livePhotos[i];
          if (!item.videoUrl) continue;
          const fn = `${baseName}_实况${i + 1}_短片.mp4`;
          const proxyUrl = buildProxyUrl(item.videoUrl, fn);
          const res = await fetch(proxyUrl);
          if (!res.ok) throw new Error(`实况${i + 1}短片下载失败`);
          const blob = await res.blob();
          triggerBlobDownload(blob, fn);
          await new Promise((r) => setTimeout(r, 300));
        }
        return new Blob();
      },
      shouldStart: () => livePhotos.some((l) => l.videoUrl),
    });
  };

  /** 混合实况批量合成 */
  const handleComposeMixedLive = async () => {
    if (!livePhotos || livePhotos.length === 0) return;
    const videosWithUrls = livePhotos.filter((l) => l.videoUrl);
    if (videosWithUrls.length === 0) return;

    composeDownload.execute({
      url: "",
      filename: "",
      successMessage: `已下载 ${videosWithUrls.length} 个实况合成视频`,
      errorMessage: "批量合成失败",
      fetchBlob: async () => {
        let audioUrl = video.musicUrl || "";
        if (!audioUrl && video.awemeId) {
          try {
            const musicRes = await fetch(
              `/api/download-music?awemeId=${encodeURIComponent(video.awemeId)}&filename=music.m4a`
            );
            if (musicRes.ok) {
              const blob = await musicRes.blob();
              if (blob.size >= 1000) audioUrl = URL.createObjectURL(blob);
            }
          } catch {
            /* 获取失败则无音乐 */
          }
        }

        for (let idx = 0; idx < videosWithUrls.length; idx++) {
          const item = videosWithUrls[idx];
          const lpIdx = livePhotos.indexOf(item);
          const fnBase = `${baseName}_实况${lpIdx + 1}`;

          const composeUrl = `/api/live-compose?videoUrl=${encodeURIComponent(item.videoUrl!)}${audioUrl ? `&audioUrl=${encodeURIComponent(audioUrl)}` : ""}&filename=${encodeURIComponent(fnBase)}.mp4`;
          const res = await fetch(composeUrl);

          if (res.ok) {
            const blob = await res.blob();
            if (blob.size >= 1000) {
              triggerBlobDownload(blob, `${fnBase}_合成.mp4`);
            } else {
              // 合成产物为空，降级为下载短片
              const fallbackUrl = buildProxyUrl(item.videoUrl!, `${fnBase}_短片.mp4`);
              const vidRes = await fetch(fallbackUrl);
              if (vidRes.ok) triggerBlobDownload(await vidRes.blob(), `${fnBase}_短片.mp4`);
            }
          } else {
            // 合成失败，降级为下载短片
            const fallbackUrl = buildProxyUrl(item.videoUrl!, `${fnBase}_短片.mp4`);
            const vidRes = await fetch(fallbackUrl);
            if (vidRes.ok) triggerBlobDownload(await vidRes.blob(), `${fnBase}_短片.mp4`);
          }

          if (idx < videosWithUrls.length - 1) {
            await new Promise((r) => setTimeout(r, 500));
          }
        }

        if (audioUrl && audioUrl.startsWith("blob:")) URL.revokeObjectURL(audioUrl);

        return new Blob();
      },
      shouldStart: () => videosWithUrls.length > 0,
    });
  };

  /* ---------------------------------- UI ---------------------------------- */

  const totalLive = livePhotos?.length || 0;

  return (
    <motion.div
      layout
      transition={{ layout: { duration: 0.42, ease: [0.16, 1, 0.3, 1] } }}
      className="w-full"
    >
      <AnimatePresence mode="wait" initial={false}>
        {/* 探测中：可见的实况扫描态（仅 slides 的 livePhotoPending 使用） */}
        {isLivePhotoPending && <LivePhotoDetecting />}

        {/* 实况探测失败 — 提供重试入口 */}
        {!isLivePhotoPending &&
          !isMixedLivePhoto &&
          !isLivePhoto &&
          video.livePhotoFailed &&
          onRetryLivePhoto && <LivePhotoFailed onRetry={onRetryLivePhoto} />}

        {/* 单图实况预览与下载 */}
        {isLivePhoto && lp && !isLivePhotoPending && (
          <SingleLivePhotoCard
            lp={lp}
            imageState={imageDownload.state}
            videoState={videoDownload.state}
            composeState={composeDownload.state}
            onDownloadImage={handleDownloadLiveImage}
            onDownloadVideo={handleDownloadLiveVideo}
            onPreviewCompose={handlePreviewCompose}
            onComposeLive={handleComposeLiveVideo}
          />
        )}

        {/* 混合实况：单实况风格预览与下载（支持多实况切换） */}
        {isMixedLivePhoto && livePhotos && livePhotos.length > 0 && !isLivePhotoPending && (
          <>
            {/* 与上方图片区做视觉分隔 */}
            <div className="my-3 h-px bg-white/10" />
            <MixedLivePhotoCard
              livePhotos={livePhotos}
              selectedLiveIndex={view.selectedLiveIndex}
              onPrev={() => view.prev(totalLive)}
              onNext={() => view.next(totalLive)}
              onSelectIndex={(i) => {
                view.setSelectedLiveIndex(i);
              }}
              batchOpen={view.batchOpen}
              onToggleBatch={() => view.setBatchOpen((o) => !o)}
              imageState={imageDownload.state}
              videoState={videoDownload.state}
              composeState={composeDownload.state}
              onDownloadSelectedImage={handleDownloadSelectedLiveImage}
              onDownloadSelectedVideo={handleDownloadSelectedLiveVideo}
              onOpenComposeModal={onOpenComposeModal}
              onDownloadLiveImages={handleDownloadLiveImages}
              onDownloadLiveVideos={handleDownloadLiveVideos}
              onComposeMixedLive={handleComposeMixedLive}
            />
          </>
        )}
      </AnimatePresence>

      {/* 单图实况合成预览弹窗 */}
      {composePreviewOpen && lp?.videoUrl && (
        <LiveComposePreviewModal
          videoUrl={lp.videoUrl}
          audioUrl={lp.musicUrl || ""}
          title={video.desc}
          onClose={() => setComposePreviewOpen(false)}
        />
      )}
    </motion.div>
  );
}
