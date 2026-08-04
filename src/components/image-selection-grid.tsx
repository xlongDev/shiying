"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Loader2, Check } from "lucide-react";
import { LivePhotoIcon } from "@/components/live-photo-icon";
import { LazyImage } from "@/components/lazy-image";
import type { LivePhotoInfo } from "@/lib/parser";

interface ImageSelectionGridProps {
  images: string[];
  selected: Set<number>;
  isSelected: (i: number) => boolean;
  onToggle: (i: number) => void;
  onToggleAll: () => void;
  selectedCount: number;
  totalImages: number;
  isMixedLivePhoto: boolean;
  livePhotos?: LivePhotoInfo[];
  isLivePhotoPending: boolean;
  onOpenViewer: (i: number) => void;
}

/**
 * 图文帖 / 混合实况帖的图片选择网格：
 * 单击选择/取消，双击预览大图，顶部全选开关。
 */
export function ImageSelectionGrid({
  images,
  isSelected,
  onToggle,
  onToggleAll,
  selectedCount,
  totalImages,
  isMixedLivePhoto,
  livePhotos,
  isLivePhotoPending,
  onOpenViewer,
}: ImageSelectionGridProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          已选 {selectedCount}/{totalImages} 张
          {isMixedLivePhoto && livePhotos && ` · ${livePhotos.length} 张实况`}
        </span>
        <button onClick={onToggleAll} className="text-xs text-primary hover:underline">
          {selectedCount === totalImages ? "取消全选" : "全选"}
        </button>
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-[280px] overflow-y-auto pr-1">
        {images.map((img, i) => (
          <motion.div
            key={i}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => onToggle(i)}
            onDoubleClick={() => onOpenViewer(i)}
            className="relative aspect-square rounded-xl overflow-hidden cursor-pointer glass flex-shrink-0"
          >
            <LazyImage
              src={img}
              filename={`thumb_${i}.jpg`}
              alt=""
              className="h-full w-full object-cover"
              placeholderClassName="absolute inset-0"
              maxRetries={3}
              retryBaseDelay={600}
            />
            <div
              className={`absolute inset-0 transition-all ${isSelected(i) ? "bg-primary/30" : "bg-black/0 hover:bg-black/20"}`}
            />
            {/* 实况照片标记 — 混合图文中的实况图片 */}
            {isMixedLivePhoto && livePhotos && livePhotos.some((lp) => lp.index === i) && (
              <div className="absolute bottom-1 left-1 glass rounded-full px-1.5 py-0.5 text-[8px] font-medium flex items-center gap-0.5 bg-purple-500/20 border border-purple-400/30">
                <LivePhotoIcon size={8} className="text-purple-400" />
                实况
              </div>
            )}
            {/* 实况加载中的图片标记 */}
            {isLivePhotoPending && (
              <div className="absolute bottom-1 left-1 glass rounded-full px-1.5 py-0.5 text-[8px] font-medium flex items-center gap-0.5">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                检测中
              </div>
            )}
            <div className="absolute top-1 right-1">
              {isSelected(i) ? (
                <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                  <Check className="h-3 w-3 text-white" />
                </div>
              ) : (
                <div className="h-5 w-5 rounded-full glass-strong border border-white/30" />
              )}
            </div>
          </motion.div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground text-center">单击选择/取消，双击预览大图</p>
    </div>
  );
}
