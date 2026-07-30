"use client";

import * as React from "react";
import { ImageIcon, Music, Clock, Film } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LivePhotoSegment } from "@/lib/ffmpeg-compose";

interface ComposeConfigPanelProps {
  totalImages: number;
  musicUrl: string | null;
  duration: number;
  livePhotos?: LivePhotoSegment[];
  perImageInput: string;
  setPerImageInput: (v: string) => void;
  defaultPerImage: number;
  estimatedDuration: string;
  onStart: () => void;
}

/**
 * 图文视频合成 — 配置阶段：设置每张图片时长后开始合成。
 */
export function ComposeConfigPanel({
  totalImages,
  musicUrl,
  duration,
  livePhotos,
  perImageInput,
  setPerImageInput,
  defaultPerImage,
  estimatedDuration,
  onStart,
}: ComposeConfigPanelProps) {
  return (
    <div className="space-y-5">
      {/* 参数设置卡片 */}
      <div className="glass rounded-2xl p-4 space-y-4">
        {/* 图片数量 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">图片数量</span>
          </div>
          <span className="text-sm font-medium">
            {totalImages} 张
            {livePhotos && livePhotos.length > 0 ? ` (${livePhotos.length} 张实况)` : ""}
          </span>
        </div>

        {/* 音乐信息 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Music className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">背景音乐</span>
          </div>
          <span className="text-sm font-medium">
            {musicUrl ? (duration > 0 ? `${duration.toFixed(0)} 秒` : "有") : "无"}
          </span>
        </div>

        {/* 每张图片显示时间 */}
        <div className="border-t border-border/50 pt-4">
          <label className="flex items-center justify-between text-sm mb-2">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4" />
              每张图片显示时间
            </span>
            <span className="text-xs text-muted-foreground">预计总时长 {estimatedDuration} 秒</span>
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min="0.2"
              max="30"
              step="0.5"
              value={perImageInput}
              onChange={(e) => setPerImageInput(e.target.value)}
              className="flex-1 bg-background/50 rounded-xl px-3 py-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
            <span className="text-sm text-muted-foreground">秒</span>
          </div>
          <div className="flex gap-2 mt-2">
            {[2, 3, 5].map((preset) => (
              <button
                key={preset}
                onClick={() => setPerImageInput(String(preset))}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                  perImageInput === String(preset)
                    ? "bg-primary text-primary-foreground"
                    : "glass hover:bg-primary/10"
                )}
              >
                {preset} 秒
              </button>
            ))}
            {duration > 0 && (
              <button
                onClick={() => setPerImageInput(String(defaultPerImage))}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                  perImageInput === String(defaultPerImage)
                    ? "bg-primary text-primary-foreground"
                    : "glass hover:bg-primary/10"
                )}
              >
                按音乐均分
              </button>
            )}
          </div>
          {musicUrl && (
            <p className="text-xs text-muted-foreground mt-2">
              音乐不够长时会自动循环播放，直至所有图片播放完毕
            </p>
          )}
        </div>
      </div>

      {/* 开始合成按钮 */}
      <button
        onClick={onStart}
        className="w-full btn-liquid rounded-2xl py-3 text-sm font-medium flex items-center justify-center gap-2"
      >
        <Film className="h-4 w-4" />
        开始合成视频
      </button>

      <p className="text-xs text-muted-foreground text-center">
        首次合成需要加载 ffmpeg 引擎（约 30MB），请耐心等待
      </p>
    </div>
  );
}
