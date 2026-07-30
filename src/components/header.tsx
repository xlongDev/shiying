"use client";

import * as React from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { ThemeToggle } from "@/components/theme-toggle";
import { SoundToggle } from "@/components/sound-toggle";
import { HistoryPanel } from "@/components/history-panel";
import { useSound } from "@/components/sound-manager";

export function Header({ onSelectHistory }: { onSelectHistory?: (url: string) => void }) {
  const { play } = useSound();

  return (
    <motion.header
      initial={{ y: -30, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-0 z-50 w-full"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-3">
        <div className="glass rounded-3xl px-5 sm:px-8 py-3 flex items-center justify-between">
          {/* Logo */}
          <motion.div
            className="group flex items-center gap-3 cursor-pointer"
            onMouseEnter={() => play("hover")}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
          >
            <div className="relative h-10 w-10">
              {/* 品牌光晕 */}
              <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-primary via-pink-500 to-violet-500 opacity-35 blur-lg transition-opacity duration-300 group-hover:opacity-60 pulse-glow" />
              {/* 图标本体 */}
              <div className="relative h-10 w-10 rounded-full overflow-hidden ring-1 ring-white/25 shadow-lg shadow-primary/30 logo-float transition-transform duration-300 group-hover:rotate-3">
                <Image
                  src="/logo.svg"
                  alt="拾影"
                  width={40}
                  height={40}
                  unoptimized
                  className="h-full w-full"
                  priority
                />
                {/* 顶部玻璃反光 */}
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
              </div>
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                拾影
              </span>
              <span className="mt-0.5 text-[10px] font-medium text-muted-foreground/80 tracking-[0.28em]">
                SHI&nbsp;YING
              </span>
            </div>
          </motion.div>

          {/* 右侧操作 */}
          <div className="flex items-center gap-2">
            <motion.a
              href="https://github.com/xlongDev"
              target="_blank"
              rel="noopener noreferrer"
              whileHover={{ scale: 1.1, rotate: 5 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => play("click")}
              className="h-10 w-10 rounded-full glass glass-shine flex items-center justify-center"
              aria-label="GitHub"
              title="GitHub @xlongDev"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.09.39-1.98 1.03-2.67-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02.8-.22 1.65-.33 2.5-.33.85 0 1.7.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.69 1.03 1.58 1.03 2.67 0 3.82-2.34 4.67-4.57 4.92.36.31.69.92.69 1.85v2.74c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0012 2z" />
              </svg>
            </motion.a>
            {onSelectHistory && <HistoryPanel onSelect={onSelectHistory} />}
            <SoundToggle />
            <ThemeToggle />
          </div>
        </div>
      </div>
    </motion.header>
  );
}
