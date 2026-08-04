"use client";

import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { EASE_EXPO } from "@/lib/motion";

export function ParseSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.4, ease: EASE_EXPO }}
      className="w-full"
    >
      <div className="glass-strong rounded-[2rem] p-4 sm:p-6 overflow-hidden">
        <div className="flex flex-col md:flex-row gap-5">
          {/* 封面骨架 */}
          <div className="relative md:w-[280px] flex-shrink-0">
            <div className="relative aspect-[9/16] rounded-3xl overflow-hidden bg-muted/40">
              <div className="absolute inset-0 shimmer" />
              {/* 中央加载图标 */}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                >
                  <Loader2 className="h-8 w-8 text-primary" />
                </motion.div>
                <p className="text-xs text-muted-foreground">正在解析视频信息…</p>
              </div>
            </div>
          </div>

          {/* 信息骨架 */}
          <div className="flex-1 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-muted/40 relative overflow-hidden">
                <div className="absolute inset-0 shimmer" />
              </div>
              <div className="space-y-2 flex-1">
                <div className="h-4 w-32 rounded-full bg-muted/40 relative overflow-hidden">
                  <div className="absolute inset-0 shimmer" />
                </div>
                <div className="h-3 w-20 rounded-full bg-muted/40 relative overflow-hidden">
                  <div className="absolute inset-0 shimmer" />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="h-3 w-full rounded-full bg-muted/40 relative overflow-hidden">
                <div className="absolute inset-0 shimmer" />
              </div>
              <div className="h-3 w-4/5 rounded-full bg-muted/40 relative overflow-hidden">
                <div className="absolute inset-0 shimmer" />
              </div>
              <div className="h-3 w-3/5 rounded-full bg-muted/40 relative overflow-hidden">
                <div className="absolute inset-0 shimmer" />
              </div>
            </div>

            <div className="flex gap-4 mt-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-4 w-16 rounded-full bg-muted/40 relative overflow-hidden">
                  <div className="absolute inset-0 shimmer" />
                </div>
              ))}
            </div>

            <div className="mt-auto space-y-2.5">
              <div className="h-12 rounded-2xl bg-muted/40 relative overflow-hidden">
                <div className="absolute inset-0 shimmer" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-10 rounded-2xl bg-muted/40 relative overflow-hidden">
                    <div className="absolute inset-0 shimmer" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
