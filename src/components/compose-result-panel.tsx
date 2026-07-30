"use client";

import * as React from "react";
import { Download, Check, RotateCcw } from "lucide-react";

interface ComposeResultPanelProps {
  videoUrl: string;
  onDownload: () => void;
  onRestart: () => void;
}

/**
 * 图文视频合成 — 合成完成阶段：预览 + 下载 / 重新合成。
 */
export function ComposeResultPanel({ videoUrl, onDownload, onRestart }: ComposeResultPanelProps) {
  return (
    <div className="space-y-4">
      {/* 视频预览 */}
      <div className="rounded-2xl overflow-hidden bg-black">
        <video
          src={videoUrl}
          controls
          autoPlay
          loop
          className="w-full max-h-[400px] object-contain"
        />
      </div>

      <div className="flex items-center gap-2 text-sm text-green-500">
        <Check className="h-4 w-4" />
        <span>视频合成完成</span>
      </div>

      {/* 下载 + 重新合成按钮 */}
      <div className="flex gap-2">
        <button
          onClick={onDownload}
          className="flex-1 btn-liquid rounded-2xl py-3 text-sm font-medium flex items-center justify-center gap-2"
        >
          <Download className="h-4 w-4" />
          下载视频
        </button>
        <button
          onClick={onRestart}
          className="px-4 rounded-2xl glass text-sm font-medium flex items-center justify-center gap-2 hover:bg-primary/10 transition-colors"
          title="重新合成"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
