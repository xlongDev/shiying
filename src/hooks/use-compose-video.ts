"use client";

import * as React from "react";
import { useSound } from "@/components/sound-manager";
import { toast } from "sonner";
import {
  composeVideoFromImages,
  unloadFFmpeg,
  type ComposeProgress,
  type ComposeStage,
  type LivePhotoSegment,
} from "@/lib/ffmpeg-compose";

export type ComposePhase = "config" | "composing" | "done" | "error";

/** 合成阶段顺序，用于计算步骤行状态（done / active / pending） */
export const COMPOSE_STAGE_ORDER: ComposeStage[] = [
  "loading-ffmpeg",
  "downloading-images",
  "downloading-live-videos",
  "downloading-music",
  "synthesizing",
  "done",
];

export interface UseComposeVideoOptions {
  open: boolean;
  images: string[];
  musicUrl: string | null;
  duration: number;
  title: string;
  /** 混合实况片段（可选） */
  livePhotos?: LivePhotoSegment[];
  /** 可选 awemeId，用于音乐 URL 降级获取 */
  awemeId?: string;
  onClose: () => void;
}

export interface UseComposeVideo {
  phase: ComposePhase;
  progress: ComposeProgress;
  videoUrl: string | null;
  error: string | null;
  perImageInput: string;
  setPerImageInput: (v: string) => void;
  defaultPerImage: number;
  /** 加权后的总体进度（0-100） */
  overallProgress: number;
  showMusicStage: boolean;
  showLiveVideoStage: boolean;
  estimatedDuration: string;
  totalImages: number;
  start: () => void;
  close: () => void;
  download: () => void;
  restart: () => void;
}

/**
 * 图文视频合成弹窗核心逻辑：
 * - phase：config → composing → done / error
 * - 持有合成产物的 object URL（videoUrl），在 close/restart 时 revokeObjectURL
 * - 下载后延迟 8s 调用 unloadFFmpeg() 释放引擎内存
 * 将 UI 渲染完全交给 ComposeConfigPanel / ComposeProgressSteps /
 * ComposeResultPanel / ComposeErrorPanel 等展示型子组件。
 */
export function useComposeVideo(opts: UseComposeVideoOptions): UseComposeVideo {
  const { open, images, musicUrl, duration, title, livePhotos, awemeId, onClose } = opts;
  const { play } = useSound();

  const [phase, setPhase] = React.useState<ComposePhase>("config");
  const [progress, setProgress] = React.useState<ComposeProgress>({
    stage: "downloading-images",
    progress: 0,
    message: "准备中...",
  });
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [perImageInput, setPerImageInput] = React.useState("");

  // 默认每图时长：有音乐按音乐时长/图片数，无音乐 3 秒（抖音官方）
  const defaultPerImage = React.useMemo(() => {
    if (duration > 0 && images.length > 0) {
      return Math.max(0.2, Number((duration / images.length).toFixed(1)));
    }
    return 3;
  }, [duration, images.length]);

  // 弹窗打开时重置为配置阶段
  React.useEffect(() => {
    if (open) {
      setPhase("config");
      setVideoUrl(null);
      setError(null);
      setProgress({ stage: "downloading-images", progress: 0, message: "准备中..." });
      setPerImageInput(String(defaultPerImage));
    }
  }, [open, defaultPerImage]);

  // 开始合成
  const start = React.useCallback(() => {
    const userPerImage = parseFloat(perImageInput);
    const perImage = !isNaN(userPerImage) && userPerImage > 0 ? userPerImage : defaultPerImage;

    setPhase("composing");
    setError(null);
    setVideoUrl(null);
    setProgress({ stage: "downloading-images", progress: 0, message: "准备中..." });

    composeVideoFromImages(images, musicUrl, duration, (p) => setProgress(p), {
      perImage,
      livePhotos,
      awemeId,
    })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        setVideoUrl(url);
        setPhase("done");
        play("complete");
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "合成失败，请重试";
        setError(msg);
        setPhase("error");
        play("error");
      });
  }, [images, musicUrl, duration, perImageInput, defaultPerImage, play, livePhotos, awemeId]);

  // 关闭时重置并清理 object URL
  const close = React.useCallback(() => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    setError(null);
    setPhase("config");
    setProgress({ stage: "downloading-images", progress: 0, message: "准备中..." });
    onClose();
  }, [videoUrl, onClose]);

  // 下载视频（下载后延迟清理 ffmpeg 内存）
  const download = React.useCallback(() => {
    if (!videoUrl) return;
    play("start");
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = `${title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").substring(0, 50) || "video"}_合成.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success("视频已开始下载");

    // 下载后延迟清理 ffmpeg 引擎内存（给浏览器足够时间完成下载）
    setTimeout(() => {
      unloadFFmpeg();
    }, 8000);
  }, [videoUrl, title, play]);

  // 重新合成
  const restart = React.useCallback(() => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    setError(null);
    setPhase("config");
  }, [videoUrl]);

  const showMusicStage = !!musicUrl;
  const totalImages = images.length;
  const currentPerImage = parseFloat(perImageInput) || defaultPerImage;
  const estimatedDuration = (currentPerImage * totalImages).toFixed(0);
  const showLiveVideoStage = !!livePhotos && livePhotos.length > 0;

  // 加权总体进度：各阶段占总进度的权重不同
  // loading-ffmpeg(0→8%) → images(8→30%) → live-videos(30→40%) → music(40→50%) → synthesizing(50→99%) → done(99→100%)
  const overallProgress = React.useMemo(() => {
    if (phase === "done" || progress.stage === "done") return 100;
    if (phase === "error") return progress.progress;

    const stage = progress.stage;
    const sub = progress.progress;
    const musicWeight = showMusicStage ? 10 : 0;
    const synthStart = 50;
    const synthEnd = 99;

    switch (stage) {
      case "loading-ffmpeg":
        return Math.round(sub * 0.08);
      case "downloading-images":
        return 8 + Math.round((sub / 100) * 22);
      case "downloading-live-videos":
        return 30 + Math.round((sub / 100) * 10);
      case "downloading-music":
        return 40 + Math.round((sub / 100) * musicWeight);
      case "synthesizing":
        return synthStart + Math.round((sub / 100) * (synthEnd - synthStart));
      default:
        return sub;
    }
  }, [phase, progress.stage, progress.progress, showMusicStage, showLiveVideoStage]);

  return {
    phase,
    progress,
    videoUrl,
    error,
    perImageInput,
    setPerImageInput,
    defaultPerImage,
    overallProgress,
    showMusicStage,
    showLiveVideoStage,
    estimatedDuration,
    totalImages,
    start,
    close,
    download,
    restart,
  };
}
