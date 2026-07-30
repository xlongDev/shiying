"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { ImageIcon, Video, Music, Film, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ComposeProgress, LivePhotoSegment } from "@/lib/ffmpeg-compose";
import { COMPOSE_STAGE_ORDER } from "@/hooks/use-compose-video";

interface StepRowProps {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  status: "pending" | "active" | "done";
  progress?: number;
  message?: string;
}

function StepRow({ icon, label, sublabel, status, progress, message }: StepRowProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors",
        status === "active"
          ? "bg-primary/10"
          : status === "done"
            ? "bg-green-500/5"
            : "bg-muted/20 opacity-50"
      )}
    >
      <div className="flex-shrink-0">
        {status === "done" ? (
          <div className="h-7 w-7 rounded-full bg-green-500/20 flex items-center justify-center">
            <Check className="h-4 w-4 text-green-500" />
          </div>
        ) : status === "active" ? (
          <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </div>
        ) : (
          <div className="h-7 w-7 rounded-full bg-muted/30 flex items-center justify-center">
            {icon}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-muted-foreground">{sublabel}</span>
        </div>
        {status === "active" && progress !== undefined && (
          <div className="mt-1.5 h-1 rounded-full bg-muted/30 overflow-hidden">
            <motion.div
              className="h-full bg-primary rounded-full"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        )}
        {status === "active" && message && (
          <p className="text-xs text-muted-foreground mt-1 truncate">{message}</p>
        )}
      </div>
    </div>
  );
}

interface ComposeProgressStepsProps {
  progress: ComposeProgress;
  totalImages: number;
  showMusicStage: boolean;
  livePhotos?: LivePhotoSegment[];
  overallProgress: number;
}

/**
 * 图文视频合成 — 合成中阶段：步骤指示器 + 总体进度条。
 */
export function ComposeProgressSteps({
  progress,
  totalImages,
  showMusicStage,
  livePhotos,
  overallProgress,
}: ComposeProgressStepsProps) {
  const idx = COMPOSE_STAGE_ORDER.indexOf(progress.stage);

  const imageStatus: "pending" | "active" | "done" =
    progress.stage === "downloading-images" ? "active" : idx > 0 ? "done" : "pending";

  const liveStatus: "pending" | "active" | "done" =
    progress.stage === "downloading-live-videos" ? "active" : idx > 2 ? "done" : "pending";

  const musicStatus: "pending" | "active" | "done" =
    progress.stage === "downloading-music" ? "active" : idx > 1 ? "done" : "pending";

  const synthStatus: "pending" | "active" | "done" =
    progress.stage === "synthesizing" ? "active" : progress.stage === "done" ? "done" : "pending";

  return (
    <div className="space-y-4">
      {/* 步骤指示器 */}
      <div className="space-y-2.5">
        <StepRow
          icon={<ImageIcon className="h-4 w-4" />}
          label="下载图片"
          sublabel={`${totalImages} 张`}
          status={imageStatus}
          progress={progress.stage === "downloading-images" ? progress.progress : undefined}
          message={progress.stage === "downloading-images" ? progress.message : undefined}
        />

        {livePhotos && livePhotos.length > 0 && (
          <StepRow
            icon={<Video className="h-4 w-4" />}
            label="下载实况短片"
            sublabel={`${livePhotos.length} 个动态片段`}
            status={liveStatus}
            progress={progress.stage === "downloading-live-videos" ? progress.progress : undefined}
            message={progress.stage === "downloading-live-videos" ? progress.message : undefined}
          />
        )}

        {showMusicStage && (
          <StepRow
            icon={<Music className="h-4 w-4" />}
            label="下载音乐"
            sublabel="背景音乐"
            status={musicStatus}
            progress={progress.stage === "downloading-music" ? progress.progress : undefined}
            message={progress.stage === "downloading-music" ? progress.message : undefined}
          />
        )}

        <StepRow
          icon={<Film className="h-4 w-4" />}
          label="合成视频"
          sublabel="ffmpeg 编码中"
          status={synthStatus}
          progress={progress.stage === "synthesizing" ? progress.progress : undefined}
          message={
            progress.stage === "synthesizing"
              ? progress.message
              : progress.stage === "loading-ffmpeg"
                ? "正在加载 ffmpeg 引擎..."
                : undefined
          }
        />
      </div>

      {/* 总进度条 */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{progress.message}</span>
          <span>{overallProgress}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
          <motion.div
            className="h-full bg-primary rounded-full"
            animate={{ width: `${overallProgress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>
    </div>
  );
}
