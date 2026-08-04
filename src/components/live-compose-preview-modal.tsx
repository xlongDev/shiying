"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Loader2, AlertCircle, X } from "lucide-react";
import { useSound } from "@/components/sound-manager";
import { ModalCloseButton } from "@/components/modal-close-button";
import { toast } from "sonner";
import { sanitizeFilename, triggerBlobDownload } from "@/lib/media-url";

interface LiveComposePreviewModalProps {
  videoUrl: string;
  audioUrl: string;
  title: string;
  onClose: () => void;
}

/**
 * 单图实况合成预览弹窗：
 * 调用 /api/live-compose?preview=1 服务端合成，合成完成后用 Blob URL 播放，
 * 弹窗内可直接下载已合成的视频，避免二次请求。
 */
export function LiveComposePreviewModal({
  videoUrl,
  audioUrl,
  title,
  onClose,
}: LiveComposePreviewModalProps) {
  const { play } = useSound();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = React.useState<"loading" | "ready" | "error">("loading");
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [blob, setBlob] = React.useState<Blob | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string>("");
  const [downloading, setDownloading] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();

    const compose = async () => {
      try {
        setPhase("loading");
        const filename = `${sanitizeFilename(title)}_实况合成.mp4`;
        const url = `/api/live-compose?videoUrl=${encodeURIComponent(videoUrl)}&audioUrl=${encodeURIComponent(audioUrl)}&filename=${encodeURIComponent(filename)}&preview=1`;

        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "合成失败" }));
          throw new Error(data.error || `合成失败 (HTTP ${res.status})`);
        }

        const videoBlob = await res.blob();
        if (videoBlob.size < 1024) {
          throw new Error("合成产物为空");
        }

        const objectUrl = URL.createObjectURL(videoBlob);
        setBlob(videoBlob);
        setBlobUrl(objectUrl);
        setPhase("ready");
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setErrorMsg(err instanceof Error ? err.message : "合成失败");
        setPhase("error");
      }
    };

    compose();

    return () => {
      controller.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, audioUrl, title]);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleDownload = async () => {
    if (!blob) return;
    play("start");
    setDownloading(true);
    try {
      const filename = `${sanitizeFilename(title)}_实况合成.mp4`;
      triggerBlobDownload(blob, filename);
      play("complete");
      toast.success("合成视频下载完成");
    } catch (err) {
      play("error");
      toast.error(err instanceof Error ? err.message : "下载失败");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md"
      onClick={onClose}
    >
      <ModalCloseButton onClick={onClose} />

      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative max-w-[90vw] max-h-[85vh] w-full md:w-auto flex flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 播放器容器 */}
        <div className="relative w-full max-w-[420px] aspect-[9/16] rounded-[2rem] overflow-hidden bg-black/40 flex items-center justify-center">
          <AnimatePresence mode="wait">
            {phase === "loading" && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white"
              >
                <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
                <span className="text-sm font-medium">正在合成预览视频…</span>
                <span className="text-xs text-white/60">短片 + 背景音乐</span>
              </motion.div>
            )}

            {phase === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white px-6 text-center"
              >
                <AlertCircle className="h-10 w-10 text-red-400" />
                <span className="text-sm font-medium">合成失败</span>
                <span className="text-xs text-white/60">{errorMsg}</span>
              </motion.div>
            )}

            {phase === "ready" && blobUrl && (
              <motion.video
                key="video"
                ref={videoRef}
                src={blobUrl}
                controls
                autoPlay
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 w-full h-full object-contain"
              />
            )}
          </AnimatePresence>
        </div>

        {/* 操作栏 */}
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="h-11 px-5 rounded-full glass text-sm font-medium flex items-center gap-2"
          >
            <X className="h-4 w-4" />
            <span>关闭</span>
          </button>

          <button
            onClick={handleDownload}
            disabled={downloading || phase !== "ready"}
            className="h-11 px-6 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-medium flex items-center gap-2 disabled:opacity-60"
          >
            {downloading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>下载中…</span>
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                <span>下载合成视频</span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
