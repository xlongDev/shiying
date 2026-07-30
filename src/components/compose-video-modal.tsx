"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Film } from "lucide-react";
import { type LivePhotoSegment } from "@/lib/ffmpeg-compose";
import { useComposeVideo } from "@/hooks/use-compose-video";
import { ComposeConfigPanel } from "@/components/compose-config-panel";
import { ComposeProgressSteps } from "@/components/compose-progress-steps";
import { ComposeResultPanel } from "@/components/compose-result-panel";
import { ComposeErrorPanel } from "@/components/compose-error-panel";

interface ComposeVideoModalProps {
  open: boolean;
  onClose: () => void;
  images: string[];
  musicUrl: string | null;
  duration: number;
  title: string;
  /** 混合实况片段（可选）：指定哪些图片索引用实况动态短片替代静态帧 */
  livePhotos?: LivePhotoSegment[];
  /** 可选 awemeId，用于音乐 URL 降级获取 */
  awemeId?: string;
}

export function ComposeVideoModal({
  open,
  onClose,
  images,
  musicUrl,
  duration,
  title,
  livePhotos,
  awemeId,
}: ComposeVideoModalProps) {
  const compose = useComposeVideo({
    open,
    images,
    musicUrl,
    duration,
    title,
    livePhotos,
    awemeId,
    onClose,
  });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
          onClick={compose.close}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="glass-strong rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <Film className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-base">图文视频合成</h3>
                  <p className="text-xs text-muted-foreground">
                    {compose.totalImages} 张图片{musicUrl ? " + 背景音乐" : ""} → MP4
                  </p>
                </div>
              </div>
              <button
                onClick={compose.close}
                className="h-9 w-9 rounded-full glass flex items-center justify-center hover:scale-110 transition-transform"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 配置阶段 */}
            {compose.phase === "config" && (
              <ComposeConfigPanel
                totalImages={compose.totalImages}
                musicUrl={musicUrl}
                duration={duration}
                livePhotos={livePhotos}
                perImageInput={compose.perImageInput}
                setPerImageInput={compose.setPerImageInput}
                defaultPerImage={compose.defaultPerImage}
                estimatedDuration={compose.estimatedDuration}
                onStart={compose.start}
              />
            )}

            {/* 合成中 */}
            {compose.phase === "composing" && !compose.error && (
              <ComposeProgressSteps
                progress={compose.progress}
                totalImages={compose.totalImages}
                showMusicStage={compose.showMusicStage}
                livePhotos={livePhotos}
                overallProgress={compose.overallProgress}
              />
            )}

            {/* 合成完成 */}
            {compose.phase === "done" && compose.videoUrl && !compose.error && (
              <ComposeResultPanel
                videoUrl={compose.videoUrl}
                onDownload={compose.download}
                onRestart={compose.restart}
              />
            )}

            {/* 错误状态 */}
            {compose.phase === "error" && compose.error && (
              <ComposeErrorPanel
                error={compose.error}
                onRestart={compose.restart}
                onClose={compose.close}
              />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
