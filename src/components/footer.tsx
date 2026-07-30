"use client";

import * as React from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { Heart } from "lucide-react";

function Logo({ className }: { className?: string }) {
  return (
    <Image
      src="/logo.svg"
      alt="拾影"
      width={28}
      height={28}
      unoptimized
      className={`h-7 w-7 rounded-full object-cover ${className ?? ""}`}
    />
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

export function Footer() {
  return (
    <motion.footer
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      className="mt-auto w-full py-10"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="glass rounded-3xl px-6 sm:px-10 py-8 sm:py-10">
          <div className="flex flex-col items-center gap-6">
            {/* Brand */}
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex items-center gap-2.5">
                <Logo />
                <span className="font-bold text-lg tracking-tight">拾影 · ShiYing</span>
              </div>
              <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
                极简无水印的抖音素材下载工具。视频、图文、实况照片与 BGM，一键解析。
              </p>
            </div>

            {/* Pills */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="px-3 py-1.5 rounded-full bg-background/60 border border-border/50 text-xs text-muted-foreground backdrop-blur-sm">
                仅供个人学习
              </span>
              <span className="px-3 py-1.5 rounded-full bg-background/60 border border-border/50 text-xs text-muted-foreground backdrop-blur-sm">
                尊重原作者版权
              </span>
              <span className="px-3 py-1.5 rounded-full bg-background/60 border border-border/50 text-xs text-muted-foreground backdrop-blur-sm">
                不存储任何数据
              </span>
            </div>

            {/* Divider */}
            <div className="w-full max-w-xs h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />

            {/* Credits */}
            <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-5 text-xs text-muted-foreground">
              <motion.a
                href="https://github.com/xlongDev"
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="flex items-center gap-1.5 hover:text-foreground transition-colors"
              >
                <GithubIcon className="h-3.5 w-3.5" />
                <span>@xlongDev</span>
              </motion.a>
              <div className="hidden sm:block h-3.5 w-px bg-border/60" />
              <div className="flex items-center gap-1.5">
                <span>Designed with</span>
                <Heart className="h-3.5 w-3.5 text-pink-500 fill-pink-500" />
                <span>by xlongDev · 2026</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.footer>
  );
}
