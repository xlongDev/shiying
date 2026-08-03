"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalCloseButtonProps {
  onClick: () => void;
  className?: string;
}

/**
 * 悬浮弹窗统一关闭按钮。
 * 与 image-viewer-modal 的浮层圆形按钮共享同一套尺寸 / 动画 / 可访问性规范，
 * 避免各弹窗各自造样式导致不一致。
 */
export function ModalCloseButton({ onClick, className }: ModalCloseButtonProps) {
  return (
    <button
      type="button"
      aria-label="关闭预览"
      onClick={onClick}
      className={cn(
        "fixed top-4 right-4 z-10 h-11 w-11 rounded-full glass-strong flex items-center justify-center text-foreground/90 hover:scale-110 active:scale-95 transition-transform duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
        className
      )}
    >
      <X className="h-6 w-6" strokeWidth={2} />
    </button>
  );
}
