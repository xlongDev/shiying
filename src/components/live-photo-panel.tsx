"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useSound } from "@/components/sound-manager";
import { toast } from "sonner";
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
import { useLivePhotoViewState } from "@/hooks/use-live-photo-view-state";
import type { DownloadState } from "@/hooks/use-media-downloader";

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
  const { play } = useSound();
  const view = useLivePhotoViewState();

  const [liveImageState, setLiveImageState] = React.useState<DownloadState>("idle");
  const [liveVideoState, setLiveVideoState] = React.useState<DownloadState>("idle");
  const [liveMusicState, setLiveMusicState] = React.useState<DownloadState>("idle");
  const [liveComposeState, setLiveComposeState] = React.useState<DownloadState>("idle");

  const isLivePhotoPending = !!video.livePhotoPending;
  const isLivePhoto = !!video.isLivePhoto && !!video.livePhoto;
  const isMixedLivePhoto =
    !!video.isMixedLivePhoto && !!video.livePhotos && video.livePhotos.length > 0;
  const lp = video.livePhoto;
  const livePhotos = video.livePhotos;

  /* ----------------------------- 单图实况下载 ----------------------------- */

  const handleDownloadLiveImage = async () => {
    if (!lp?.imageUrl) return;
    play("start");
    setLiveImageState("downloading");
    const filename = `${sanitizeFilename(video.desc)}_实况原图.jpg`;
    try {
      const proxyUrl = buildMediaProxyUrl(lp.imageUrl, filename);
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`);
      const blob = await res.blob();
      triggerBlobDownload(blob, filename);
      setLiveImageState("done");
      play("complete");
      toast.success("实况原图下载完成");
      setTimeout(() => setLiveImageState("idle"), 2000);
    } catch (err) {
      setLiveImageState("idle");
      play("error");
      toast.error(err instanceof Error ? err.message : "下载失败");
    }
  };

  const handleDownloadLiveVideo = async () => {
    if (!lp?.videoUrl) return;
    play("start");
    setLiveVideoState("downloading");
    const filename = `${sanitizeFilename(video.desc)}_实况短片.mp4`;
    try {
      const proxyUrl = buildProxyUrl(lp.videoUrl, filename);
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`);
      const blob = await res.blob();
      triggerBlobDownload(blob, filename);
      setLiveVideoState("done");
      play("complete");
      toast.success("实况短片下载完成");
      setTimeout(() => setLiveVideoState("idle"), 2000);
    } catch (err) {
      setLiveVideoState("idle");
      play("error");
      toast.error(err instanceof Error ? err.message : "下载失败");
    }
  };

  const handleDownloadLiveMusic = async () => {
    if (!lp?.musicUrl) return;
    play("start");
    setLiveMusicState("downloading");
    const filename = `${sanitizeFilename(video.desc)}_实况BGM.m4a`;
    try {
      const proxyUrl = buildMediaProxyUrl(lp.musicUrl, filename);
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`);
      const blob = await res.blob();
      triggerBlobDownload(blob, filename);
      setLiveMusicState("done");
      play("complete");
      toast.success("实况 BGM 下载完成");
      setTimeout(() => setLiveMusicState("idle"), 2000);
    } catch (err) {
      setLiveMusicState("idle");
      play("error");
      toast.error(err instanceof Error ? err.message : "下载失败");
    }
  };

  const handleComposeLiveVideo = async () => {
    if (!lp?.videoUrl) return;
    play("start");
    setLiveComposeState("downloading");
    const filename = `${sanitizeFilename(video.desc)}_实况合成.mp4`;
    try {
      const composeUrl = `/api/live-compose?videoUrl=${encodeURIComponent(
        lp.videoUrl
      )}&audioUrl=${encodeURIComponent(lp.musicUrl)}&filename=${encodeURIComponent(filename)}`;
      const res = await fetch(composeUrl);
      if (!res.ok) {
        let errMsg = `合成失败 (HTTP ${res.status})`;
        try {
          const errJson = await res.json();
          if (typeof errJson.error === "string") errMsg = errJson.error;
        } catch {
          /* ignore */
        }
        throw new Error(errMsg);
      }
      const blob = await res.blob();
      if (blob.size < 1000) throw new Error("合成产物为空");
      triggerBlobDownload(blob, filename);
      setLiveComposeState("done");
      play("complete");
      toast.success("实况合成视频下载完成");
      setTimeout(() => setLiveComposeState("idle"), 2000);
    } catch (err) {
      setLiveComposeState("idle");
      play("error");
      toast.error(err instanceof Error ? err.message : "合成失败");
    }
  };

  /* ----------------------------- 混合实况下载 ----------------------------- */

  const handleDownloadSelectedLiveImage = async () => {
    if (!livePhotos || livePhotos.length === 0) return;
    const lpItem = livePhotos[view.selectedLiveIndex];
    if (!lpItem?.imageUrl) return;
    play("start");
    setLiveImageState("downloading");
    const filename = `${sanitizeFilename(video.desc)}_实况${view.selectedLiveIndex + 1}_原图.jpg`;
    try {
      const proxyUrl = buildMediaProxyUrl(lpItem.imageUrl, filename);
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`);
      const blob = await res.blob();
      triggerBlobDownload(blob, filename);
      setLiveImageState("done");
      play("complete");
      toast.success("实况原图下载完成");
      setTimeout(() => setLiveImageState("idle"), 2000);
    } catch (err) {
      setLiveImageState("idle");
      play("error");
      toast.error(err instanceof Error ? err.message : "下载失败");
    }
  };

  const handleDownloadSelectedLiveVideo = async () => {
    if (!livePhotos || livePhotos.length === 0) return;
    const lpItem = livePhotos[view.selectedLiveIndex];
    if (!lpItem?.videoUrl) return;
    play("start");
    setLiveVideoState("downloading");
    const filename = `${sanitizeFilename(video.desc)}_实况${view.selectedLiveIndex + 1}_短片.mp4`;
    try {
      const proxyUrl = buildProxyUrl(lpItem.videoUrl, filename);
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`);
      const blob = await res.blob();
      triggerBlobDownload(blob, filename);
      setLiveVideoState("done");
      play("complete");
      toast.success("实况短片下载完成");
      setTimeout(() => setLiveVideoState("idle"), 2000);
    } catch (err) {
      setLiveVideoState("idle");
      play("error");
      toast.error(err instanceof Error ? err.message : "下载失败");
    }
  };

  /** 混合实况专用：下载 BGM（使用 video.musicUrl 而非 lp.musicUrl） */
  const handleDownloadMixedMusic = async () => {
    const musicSrc = video.musicUrl;
    if (!musicSrc && !video.awemeId) {
      toast.error("该帖子没有可下载的背景音乐");
      return;
    }
    play("start");
    setLiveMusicState("downloading");
    const filename = `${sanitizeFilename(video.desc)}_背景音乐.m4a`;
    try {
      let downloadUrl = "";
      if (musicSrc) {
        downloadUrl = buildMediaProxyUrl(musicSrc, filename);
      } else {
        downloadUrl = `/api/download-music?awemeId=${encodeURIComponent(
          video.awemeId
        )}&filename=${encodeURIComponent(filename)}`;
      }
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`);
      const blob = await res.blob();
      if (blob.size < 1000) throw new Error("音频文件为空");
      triggerBlobDownload(blob, filename);
      setLiveMusicState("done");
      play("complete");
      toast.success("背景音乐下载完成");
      setTimeout(() => setLiveMusicState("idle"), 2000);
    } catch (err) {
      setLiveMusicState("idle");
      play("error");
      toast.error(err instanceof Error ? err.message : "背景音乐下载失败");
    }
  };

  const handleDownloadLiveImages = async () => {
    if (!livePhotos || livePhotos.length === 0) return;
    play("start");
    setLiveImageState("downloading");
    try {
      for (let i = 0; i < livePhotos.length; i++) {
        const lpItem = livePhotos[i];
        const filename = `${sanitizeFilename(video.desc)}_实况${i + 1}_原图.jpg`;
        const proxyUrl = buildMediaProxyUrl(lpItem.imageUrl, filename);
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error(`实况${i + 1}原图下载失败`);
        const blob = await res.blob();
        triggerBlobDownload(blob, filename);
        await new Promise((r) => setTimeout(r, 300));
      }
      setLiveImageState("done");
      play("complete");
      toast.success(`${livePhotos.length} 张实况原图下载完成`);
      setTimeout(() => setLiveImageState("idle"), 2000);
    } catch (err) {
      setLiveImageState("idle");
      play("error");
      toast.error(err instanceof Error ? err.message : "下载失败");
    }
  };

  const handleDownloadLiveVideos = async () => {
    if (!livePhotos || livePhotos.length === 0) return;
    play("start");
    setLiveVideoState("downloading");
    try {
      for (let i = 0; i < livePhotos.length; i++) {
        const lpItem = livePhotos[i];
        if (!lpItem.videoUrl) continue;
        const filename = `${sanitizeFilename(video.desc)}_实况${i + 1}_短片.mp4`;
        const proxyUrl = buildProxyUrl(lpItem.videoUrl, filename);
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error(`实况${i + 1}短片下载失败`);
        const blob = await res.blob();
        triggerBlobDownload(blob, filename);
        await new Promise((r) => setTimeout(r, 300));
      }
      setLiveVideoState("done");
      play("complete");
      toast.success(`${livePhotos.filter((lp) => lp.videoUrl).length} 个实况短片下载完成`);
      setTimeout(() => setLiveVideoState("idle"), 2000);
    } catch (err) {
      setLiveVideoState("idle");
      play("error");
      toast.error(err instanceof Error ? err.message : "下载失败");
    }
  };

  const handleComposeMixedLiveVideo = async () => {
    if (!livePhotos || livePhotos.length === 0) return;
    const videosWithUrls = livePhotos.filter((lp) => lp.videoUrl);
    if (videosWithUrls.length === 0) return;

    play("start");
    setLiveComposeState("downloading");
    try {
      let audioUrl = video.musicUrl || "";
      if (!audioUrl && video.awemeId) {
        try {
          const musicRes = await fetch(
            `/api/download-music?awemeId=${encodeURIComponent(video.awemeId)}&filename=music.m4a`
          );
          if (musicRes.ok) {
            const blob = await musicRes.blob();
            if (blob.size >= 1000) {
              audioUrl = URL.createObjectURL(blob);
            }
          }
        } catch {
          /* 获取失败则无音乐 */
        }
      }

      for (let idx = 0; idx < videosWithUrls.length; idx++) {
        const lpItem = videosWithUrls[idx];
        const lpIdx = livePhotos.indexOf(lpItem);
        const filenameBase = `${sanitizeFilename(video.desc)}_实况${lpIdx + 1}`;

        const composeUrl = `/api/live-compose?videoUrl=${encodeURIComponent(
          lpItem.videoUrl!
        )}${audioUrl ? `&audioUrl=${encodeURIComponent(audioUrl)}` : ""}&filename=${encodeURIComponent(
          filenameBase
        )}.mp4`;
        const res = await fetch(composeUrl);

        if (res.ok) {
          const blob = await res.blob();
          if (blob.size >= 1000) {
            triggerBlobDownload(blob, `${filenameBase}_合成.mp4`);
          } else {
            const proxyUrl = buildProxyUrl(lpItem.videoUrl!, `${filenameBase}_短片.mp4`);
            const vidRes = await fetch(proxyUrl);
            if (vidRes.ok) {
              const vidBlob = await vidRes.blob();
              triggerBlobDownload(vidBlob, `${filenameBase}_短片.mp4`);
            }
          }
        } else {
          const proxyUrl = buildProxyUrl(lpItem.videoUrl!, `${filenameBase}_短片.mp4`);
          const vidRes = await fetch(proxyUrl);
          if (vidRes.ok) {
            const vidBlob = await vidRes.blob();
            triggerBlobDownload(vidBlob, `${filenameBase}_短片.mp4`);
          }
        }

        if (idx < videosWithUrls.length - 1) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      if (audioUrl && audioUrl.startsWith("blob:")) {
        URL.revokeObjectURL(audioUrl);
      }

      setLiveComposeState("done");
      play("complete");
      toast.success(`已下载 ${videosWithUrls.length} 个实况合成视频`);
      setTimeout(() => setLiveComposeState("idle"), 2000);
    } catch (err) {
      setLiveComposeState("idle");
      play("error");
      toast.error(err instanceof Error ? err.message : "批量合成失败");
    }
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
        {/* 探测中：可见的实况扫描态 */}
        {isLivePhotoPending && <LivePhotoDetecting />}

        {/* 静默后台探测（多图 note）：不展示骨架屏/失败面板，仅一行轻量提示 */}
        {!isLivePhotoPending &&
          !isMixedLivePhoto &&
          !isLivePhoto &&
          !video.livePhotoFailed &&
          video.livePhotoBackground && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70 px-1 py-0.5">
              <Loader2 className="h-3 w-3 animate-spin text-purple-400" />
              正在智能探测实况照片…
            </div>
          )}

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
            imageState={liveImageState}
            videoState={liveVideoState}
            musicState={liveMusicState}
            composeState={liveComposeState}
            onDownloadImage={handleDownloadLiveImage}
            onDownloadVideo={handleDownloadLiveVideo}
            onDownloadMusic={handleDownloadLiveMusic}
            onComposeLive={handleComposeLiveVideo}
          />
        )}

        {/* 混合实况：单实况风格预览与下载（支持多实况切换） */}
        {isMixedLivePhoto && livePhotos && livePhotos.length > 0 && !isLivePhotoPending && (
          <MixedLivePhotoCard
            video={video}
            livePhotos={livePhotos}
            selectedLiveIndex={view.selectedLiveIndex}
            onPrev={() => view.prev(totalLive)}
            onNext={() => view.next(totalLive)}
            onSelectIndex={(i) => {
              view.setSelectedLiveIndex(i);
              play("click");
            }}
            batchOpen={view.batchOpen}
            onToggleBatch={() => view.setBatchOpen((o) => !o)}
            imageState={liveImageState}
            videoState={liveVideoState}
            musicState={liveMusicState}
            composeState={liveComposeState}
            onDownloadSelectedImage={handleDownloadSelectedLiveImage}
            onDownloadSelectedVideo={handleDownloadSelectedLiveVideo}
            onDownloadMixedMusic={handleDownloadMixedMusic}
            onOpenComposeModal={onOpenComposeModal}
            onDownloadLiveImages={handleDownloadLiveImages}
            onDownloadLiveVideos={handleDownloadLiveVideos}
            onComposeMixedLive={handleComposeMixedLiveVideo}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
