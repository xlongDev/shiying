"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * 实况探测「扫描镜」图标：外环 12 点缓慢旋转 + 中心脉冲 + 背后辉光呼吸。
 * 全部使用 CSS transform/opacity 动画；reduced-motion 下静态呈现。
 */
function LivePhotoScope({ reduce }: { reduce: boolean }) {
  const dots = Array.from({ length: 12 }, (_, i) => {
    const a = i * 30 - 90;
    const r = (a * Math.PI) / 180;
    return { cx: 24 + 16 * Math.cos(r), cy: 24 + 16 * Math.sin(r) };
  });

  return (
    <div className="relative h-12 w-12 flex-shrink-0">
      <div
        className={cn("absolute inset-0 rounded-full", !reduce && "animate-lp-glow")}
        style={{
          background: "radial-gradient(circle, rgba(168,85,247,0.38), transparent 70%)",
          transformOrigin: "center",
        }}
      />
      <svg width="48" height="48" viewBox="0 0 48 48" className="relative">
        <g
          className={cn(!reduce && "animate-lp-spin-slow")}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        >
          <circle
            cx="24"
            cy="24"
            r="17"
            fill="none"
            stroke="rgba(168,85,247,0.4)"
            strokeWidth="1.5"
            strokeDasharray="2 4"
          />
          {dots.map((d, i) => (
            <circle key={i} cx={d.cx} cy={d.cy} r="1.7" fill="#c084fc" />
          ))}
        </g>
        <circle
          cx="24"
          cy="24"
          r="5"
          fill="url(#lpGradScope)"
          className={cn(!reduce && "animate-lp-pulse")}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        />
        <defs>
          <radialGradient id="lpGradScope">
            <stop offset="0%" stopColor="#f0abfc" />
            <stop offset="100%" stopColor="#a855f7" />
          </radialGradient>
        </defs>
      </svg>
    </div>
  );
}

/**
 * 实况照片探测中骨架屏（液态玻璃 · 紧凑胶片条风格）。
 */
export function LivePhotoDetecting() {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key="detecting"
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } }}
      exit={{ opacity: 0, y: -8, transition: { duration: 0.22, ease: [0.7, 0, 0.84, 0] } }}
      className="relative overflow-hidden rounded-2xl border border-purple-400/20 bg-gradient-to-br from-purple-500/[0.06] to-pink-500/[0.04] px-4 py-3.5"
    >
      <div className="flex items-center gap-3.5">
        <LivePhotoScope reduce={!!reduce} />
        <div className="min-w-0">
          <p className="text-sm font-semibold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">
            正在探测实况照片
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            分析图片元数据，识别动态短片…
          </p>
        </div>
        <span
          className={cn(
            "ml-auto text-[11px] font-medium text-purple-400/80 tabular-nums",
            !reduce && "animate-lp-pulse-text"
          )}
        >
          识别中
        </span>
      </div>

      {/* 细进度轨道：色块平移（transform 驱动，无布局抖动） */}
      <div className="relative mt-3 h-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10">
        <div
          className={cn(
            "absolute inset-y-0 left-0 w-1/3 rounded-full",
            !reduce && "animate-lp-shimmer"
          )}
          style={{
            background: "linear-gradient(90deg, transparent, #a855f7, #ec4899, transparent)",
          }}
        />
      </div>
    </motion.div>
  );
}
