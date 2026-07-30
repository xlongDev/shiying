"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export type SpeedMenuTone = "video" | "audio";

interface SpeedMenuToneStyle {
  /** Tailwind 类名：用于无法用 inline style 表达的 dark: 变体（背景 / 边框） */
  containerClass: string;
  /** 内联样式：玻璃质感、阴影、模糊等 */
  style: React.CSSProperties;
  labelClass: string;
  speedActiveClass: string;
  speedActiveStyle: React.CSSProperties;
  speedInactiveClass: string;
  checkClass: string;
  dividerClass: string;
}

const TONE_STYLES: Record<SpeedMenuTone, SpeedMenuToneStyle> = {
  // 视频播放器：始终深色玻璃（无 dark 变体）
  video: {
    containerClass: "",
    style: {
      background: "rgba(20,20,28,0.80)",
      border: "1px solid rgba(255,255,255,0.08)",
      backdropFilter: "blur(24px) saturate(180%)",
      WebkitBackdropFilter: "blur(24px) saturate(180%)",
      boxShadow:
        "0 8px 32px rgba(0,0,0,0.40), 0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.06)",
    },
    labelClass: "text-white/30",
    speedActiveClass: "text-purple-300",
    speedActiveStyle: { background: "rgba(168,85,247,0.12)" },
    speedInactiveClass: "text-white/60 hover:text-white/90",
    checkClass: "text-purple-400",
    dividerClass: "bg-white/6",
  },
  // 音频播放器：亮 / 暗双形态玻璃
  audio: {
    containerClass:
      "bg-white/92 dark:bg-slate-900/95 border border-white/55 dark:border-slate-700/50",
    style: {
      backdropFilter: "blur(24px) saturate(180%)",
      WebkitBackdropFilter: "blur(24px) saturate(180%)",
      boxShadow:
        "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.45)",
    },
    labelClass: "text-slate-400",
    speedActiveClass: "text-purple-600",
    speedActiveStyle: { background: "rgba(168,85,247,0.10)" },
    speedInactiveClass: "text-slate-600 hover:text-slate-900",
    checkClass: "text-purple-500",
    dividerClass: "bg-slate-200",
  },
};

export interface SpeedMenuProps {
  open: boolean;
  /** 由触发按钮的 getBoundingClientRect 计算出的定位（已含偏移） */
  menuPos: { top: number; left: number };
  currentRate: number;
  onSelectRate: (rate: number) => void;
  onClose: () => void;
  tone: SpeedMenuTone;
  /** 速度列表下方的额外项（如全屏 / 画中画 / 下载 / 循环），渲染在分隔线之后 */
  extraItems?: React.ReactNode;
}

/**
 * 倍速菜单（Portal 渲染于 document.body）。
 *
 * 纯展示叶组件：自身只负责「速度列表 + 额外项 + 玻璃外壳 + 定位 + 点击外部关闭」。
 * 触发按钮、menuPos 计算、以及各额外项的点击行为仍由父播放器组件持有，
 * 以保证与各自布局/状态机的最小耦合。
 */
export function SpeedMenu({
  open,
  menuPos,
  currentRate,
  onSelectRate,
  onClose,
  tone,
  extraItems,
}: SpeedMenuProps) {
  const cfg = TONE_STYLES[tone];

  // 用 ref 持有最新的 onClose，避免父组件每次渲染传入新闭包导致外部点击监听反复重绑
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  });

  /* 点击外部关闭（延迟绑定，避免打开当次点击立即触发） */
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-glass-menu]")) onCloseRef.current();
    };
    const id = setTimeout(() => document.addEventListener("click", handler), 10);
    return () => {
      clearTimeout(id);
      document.removeEventListener("click", handler);
    };
  }, [open]);

  if (typeof document === "undefined") return null;

  return open
    ? createPortal(
        <AnimatePresence>
          <motion.div
            data-glass-menu
            initial={{ opacity: 0, scale: 0.9, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className={`fixed min-w-[116px] py-0.5 rounded-2xl overflow-hidden z-[9999] ${cfg.containerClass}`}
            style={{
              top: `${menuPos.top}px`,
              left: `${menuPos.left}px`,
              transform: "translateX(-50%)",
              ...cfg.style,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 播放速度 */}
            <div className="px-2 pt-1 pb-0.5">
              <span
                className={`text-[8px] uppercase tracking-widest font-medium ${cfg.labelClass}`}
              >
                速度
              </span>
            </div>
            {SPEED_OPTIONS.map((rate) => (
              <button
                key={rate}
                onClick={() => onSelectRate(rate)}
                className={`w-full px-2.5 py-1 text-left text-[11px] font-mono flex items-center gap-1.5 transition-colors ${
                  currentRate === rate ? cfg.speedActiveClass : cfg.speedInactiveClass
                }`}
                style={currentRate === rate ? cfg.speedActiveStyle : undefined}
              >
                {rate}x
                {currentRate === rate && (
                  <svg
                    className={`h-2.5 w-2.5 ml-auto ${cfg.checkClass}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}

            {extraItems != null && (
              <>
                <div className={`mx-2 my-0.5 h-px ${cfg.dividerClass}`} />
                {extraItems}
              </>
            )}
          </motion.div>
        </AnimatePresence>,
        document.body
      )
    : null;
}
