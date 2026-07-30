"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useSound } from "@/components/sound-manager";
import { LivePhotoIcon } from "@/components/live-photo-icon";

interface LivePhotoFailedProps {
  onRetry: () => void;
}

/**
 * 实况照片探测失败面板：提供「重新探测」入口，避免静默降级为普通图片。
 */
export function LivePhotoFailed({ onRetry }: LivePhotoFailedProps) {
  const { play } = useSound();
  return (
    <motion.div
      key="retry"
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.26, ease: [0.7, 0, 0.84, 0] } }}
      className="space-y-2.5 rounded-2xl glass p-4 border border-amber-400/30"
    >
      <div className="flex items-center gap-2">
        <LivePhotoIcon size={16} className="text-amber-400" />
        <span className="text-sm font-semibold">实况照片探测未完成</span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        该链接疑似含实况照片，但本次探测未能获取到动态短片资源（可能是加载时机问题）。点击下方按钮可重新探测。
      </p>
      <motion.button
        onClick={() => {
          play("click");
          onRetry();
        }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="w-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl py-2 text-xs font-semibold text-white flex items-center justify-center gap-2"
      >
        <Loader2 className="h-3.5 w-3.5" />
        重新探测实况照片
      </motion.button>
    </motion.div>
  );
}
