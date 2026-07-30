"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Download, Loader2, X } from "lucide-react";
import { useSound } from "@/components/sound-manager";
import { toast } from "sonner";
import {
  buildProxyUrl,
  buildStreamUrl,
  buildMediaProxyUrl,
  sanitizeFilename,
  triggerBlobDownload,
} from "@/lib/media-url";

interface VideoPreviewModalProps {
  videoUrl: string;
  cover: string;
  title: string;
  onClose: () => void;
}

/**
 * 视频预览弹窗：内嵌播放器 + 下载按钮（带 downloading 态）。
 */
export function VideoPreviewModal({ videoUrl, cover, title, onClose }: VideoPreviewModalProps) {
  const { play } = useSound();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [downloading, setDownloading] = React.useState(false);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleDownload = async () => {
    play("start");
    setDownloading(true);
    const filename = `${sanitizeFilename(title)}.mp4`;
    try {
      const proxyUrl = buildProxyUrl(videoUrl, filename);
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`);
      const blob = await res.blob();
      triggerBlobDownload(blob, filename);
      play("complete");
      toast.success("视频下载完成");
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
      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        className="fixed top-4 right-4 z-10 h-10 w-10 rounded-full glass-strong flex items-center justify-center"
      >
        <X className="h-5 w-5" />
      </button>

      {/* 视频播放器 */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative max-w-[90vw] max-h-[85vh] flex flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <video
          ref={videoRef}
          src={buildStreamUrl(videoUrl)}
          poster={cover ? buildMediaProxyUrl(cover, "cover.jpg") : undefined}
          controls
          autoPlay
          className="max-w-full max-h-[75vh] rounded-[2rem] object-contain"
        />

        {/* 下载按钮 */}
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="h-11 px-6 rounded-full bg-primary text-primary-foreground text-sm font-medium flex items-center gap-2 disabled:opacity-60"
        >
          {downloading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>下载中...</span>
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              <span>下载视频</span>
            </>
          )}
        </button>
      </motion.div>
    </motion.div>
  );
}
