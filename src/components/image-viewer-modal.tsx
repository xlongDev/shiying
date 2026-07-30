"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Download, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useSound } from "@/components/sound-manager";
import { toast } from "sonner";
import { buildMediaProxyUrl } from "@/lib/media-url";

interface ImageViewerModalProps {
  images: string[];
  initialIndex: number;
  onClose: () => void;
}

/**
 * 图片大图画廊弹窗：左右切换、键盘导航、单张下载。
 */
export function ImageViewerModal({ images, initialIndex, onClose }: ImageViewerModalProps) {
  const [index, setIndex] = React.useState(initialIndex);
  const { play } = useSound();

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) {
        setIndex(index - 1);
        play("click");
      } else if (e.key === "ArrowRight" && index < images.length - 1) {
        setIndex(index + 1);
        play("click");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [index, images.length, onClose, play]);

  const handleDownload = async () => {
    play("start");
    try {
      const proxyUrl = buildMediaProxyUrl(images[index], `image_${index + 1}.jpg`);
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error("下载失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `image_${index + 1}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("图片已下载");
    } catch {
      toast.error("下载失败");
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
      {/* 左箭头 — 固定在屏幕左侧 */}
      {index > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIndex(index - 1);
            play("click");
          }}
          className="fixed left-4 sm:left-8 top-1/2 -translate-y-1/2 z-10 h-14 w-14 rounded-full glass-strong flex items-center justify-center hover:scale-110 transition-transform"
        >
          <ChevronLeft className="h-7 w-7" />
        </button>
      )}

      {/* 右箭头 — 固定在屏幕右侧 */}
      {index < images.length - 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIndex(index + 1);
            play("click");
          }}
          className="fixed right-4 sm:right-8 top-1/2 -translate-y-1/2 z-10 h-14 w-14 rounded-full glass-strong flex items-center justify-center hover:scale-110 transition-transform"
        >
          <ChevronRight className="h-7 w-7" />
        </button>
      )}

      {/* 关闭按钮 — 固定在右上角 */}
      <button
        onClick={onClose}
        className="fixed top-4 right-4 z-10 h-10 w-10 rounded-full glass-strong flex items-center justify-center"
      >
        <X className="h-5 w-5" />
      </button>

      {/* 图片 — 居中显示 */}
      <motion.div
        key={index}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.2 }}
        className="relative max-w-[85vw] max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={buildMediaProxyUrl(images[index], `preview_${index}.jpg`)}
          alt=""
          className="max-w-full max-h-[80vh] object-contain rounded-[2rem]"
          loading="lazy"
          decoding="async"
        />
      </motion.div>

      {/* 底部控制栏 — 固定在屏幕底部 */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-4 glass-strong rounded-full px-6 py-3">
        <span className="text-sm font-medium">
          {index + 1} / {images.length}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleDownload();
          }}
          className="h-9 px-4 rounded-full bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5"
        >
          <Download className="h-4 w-4" />
          下载
        </button>
      </div>
    </motion.div>
  );
}
