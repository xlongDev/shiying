"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Loader2, Check, LucideIcon } from "lucide-react";
import type { DownloadState } from "@/hooks/use-media-downloader";

export interface DownloadButtonProps {
  /** 当前下载状态 */
  state: DownloadState;
  /** idle 状态图标 */
  idleIcon: LucideIcon;
  /** idle 状态文案 */
  label: string;
  /** downloading 状态文案（默认"下载中"/"获取中"） */
  loadingLabel?: string;
  /** done 状态文案（默认"已下载"） */
  doneLabel?: string;
  /** 点击回调 */
  onClick: () => void;
  /** 是否禁用（state===downloading 时自动禁用，可叠加其他条件） */
  disabled?: boolean;
  /** 按钮标题（tooltip） */
  title?: string;
  /** 额外 className */
  className?: string;
  /** 是否使用 framer-motion 动画（默认 true） */
  animated?: boolean;
}

/**
 * 三态下载按钮：idle → downloading → done → idle（自动重置）。
 *
 * 统一封装「图标+文案+状态切换+禁用逻辑」，消除 mixed-live-photo-card 等
 * 组件中大量重复的按钮模板代码。
 */
export function DownloadButton({
  state,
  idleIcon: IdleIcon,
  label,
  loadingLabel,
  doneLabel,
  onClick,
  disabled,
  title,
  className = "",
  animated = true,
}: DownloadButtonProps) {
  const isDisabled = disabled || state === "downloading";

  const content = React.useMemo(() => {
    if (state === "downloading") {
      return (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="text-xs">{loadingLabel ?? "下载中"}</span>
        </>
      );
    }
    if (state === "done") {
      return (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-xs text-emerald-600">{doneLabel ?? "已下载"}</span>
        </>
      );
    }
    return (
      <>
        <IdleIcon className="h-3.5 w-3.5" />
        <span className="text-xs">{label}</span>
      </>
    );
  }, [state, IdleIcon, label, loadingLabel, doneLabel]);

  const baseClassName = `glass rounded-xl py-2 text-xs font-medium flex items-center justify-center gap-1 hover:bg-primary/10 transition-colors disabled:opacity-50 ${isDisabled ? "disabled:cursor-not-allowed" : ""} ${className}`;

  if (animated) {
    return (
      <motion.button
        onClick={onClick}
        disabled={isDisabled}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className={baseClassName}
        title={title}
      >
        {content}
      </motion.button>
    );
  }

  return (
    <button onClick={onClick} disabled={isDisabled} className={baseClassName} title={title}>
      {content}
    </button>
  );
}
