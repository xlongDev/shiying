"use client";

import * as React from "react";
import { AlertCircle, RotateCcw } from "lucide-react";

interface ComposeErrorPanelProps {
  error: string;
  onRestart: () => void;
  onClose: () => void;
}

/**
 * 图文视频合成 — 错误阶段：提示失败原因，提供重新合成 / 关闭。
 */
export function ComposeErrorPanel({ error, onRestart, onClose }: ComposeErrorPanelProps) {
  return (
    <div className="space-y-4 text-center py-4">
      <div className="h-14 w-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
        <AlertCircle className="h-7 w-7 text-red-500" />
      </div>
      <div>
        <p className="font-medium text-sm">合成失败</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{error}</p>
      </div>
      <div className="flex gap-2 justify-center">
        <button
          onClick={onRestart}
          className="px-6 py-2.5 rounded-full btn-liquid text-sm font-medium flex items-center gap-2"
        >
          <RotateCcw className="h-4 w-4" />
          重新合成
        </button>
        <button
          onClick={onClose}
          className="px-6 py-2.5 rounded-full glass text-sm font-medium hover:bg-primary/10 transition-colors"
        >
          关闭
        </button>
      </div>
    </div>
  );
}
