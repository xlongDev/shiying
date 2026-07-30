"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Zap, ShieldCheck, Gem, Music4, Package } from "lucide-react";
import { LivePhotoIcon } from "@/components/live-photo-icon";
import { useSound } from "@/components/sound-manager";

type IconRenderer = React.FC<{ className?: string }>;

const FEATURES = [
  {
    Icon: (({ className }: { className?: string }) => (
      <Zap className={className} strokeWidth={2.2} />
    )) as IconRenderer,
    title: "极速解析",
    desc: "粘贴链接自动解析，视频、图文、混合实况一键识别，无需手动提取",
    gradient: "from-amber-400 to-orange-500",
  },
  {
    Icon: (({ className }: { className?: string }) => (
      <Gem className={className} strokeWidth={2.2} />
    )) as IconRenderer,
    title: "高清无水印",
    desc: "获取平台原始视频流与图片，告别压缩画质与平台水印",
    gradient: "from-pink-500 to-rose-500",
  },
  {
    Icon: (({ className }: { className?: string }) => (
      <LivePhotoIcon size={24} className={className} />
    )) as IconRenderer,
    title: "实况照片",
    desc: "支持单图实况与混合图文，分别下载高清原图与无水印动态短片",
    gradient: "from-emerald-400 to-teal-500",
  },
  {
    Icon: (({ className }: { className?: string }) => (
      <Music4 className={className} strokeWidth={2.2} />
    )) as IconRenderer,
    title: "音乐提取",
    desc: "一键提取视频原声与 BGM，支持 MP3 / M4A 格式单独下载",
    gradient: "from-violet-500 to-purple-500",
  },
  {
    Icon: (({ className }: { className?: string }) => (
      <Package className={className} strokeWidth={2.2} />
    )) as IconRenderer,
    title: "批量打包",
    desc: "图文帖子自动打包 ZIP，多图一键下载，不再繁琐逐张保存",
    gradient: "from-indigo-500 to-blue-500",
  },
  {
    Icon: (({ className }: { className?: string }) => (
      <ShieldCheck className={className} strokeWidth={2.2} />
    )) as IconRenderer,
    title: "隐私安全",
    desc: "服务端实时解析，不存储链接、不保留视频、无日志，用完即走",
    gradient: "from-cyan-400 to-sky-500",
  },
];

export function FeaturesSection() {
  const { play } = useSound();

  return (
    <section className="relative w-full py-16 sm:py-24 px-5 sm:px-8 overflow-hidden">
      {/* 背景装饰光晕 */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[640px] h-[480px] rounded-full bg-gradient-to-r from-primary/8 via-pink-500/8 to-violet-500/8 blur-[140px] pointer-events-none" />

      <div className="relative max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          {/*  eyebrow */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass glass-shine text-xs font-medium text-muted-foreground mb-5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
            </span>
            核心能力
          </div>

          <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">
            为什么选择 <span className="text-gradient">拾影</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-base sm:text-lg leading-relaxed">
            从一条链接到高清素材，只需几秒。视频、图文、实况照片、BGM，全部无水印下载。
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{
                duration: 0.5,
                delay: i * 0.08,
                ease: [0.22, 1, 0.36, 1],
              }}
              whileHover={{ y: -6 }}
              onHoverStart={() => play("hover")}
              className="glass glass-shine rounded-3xl p-6 group cursor-default relative overflow-hidden"
            >
              {/* 悬停时微弱的同色系背景晕染 */}
              <div
                className={`absolute inset-0 bg-gradient-to-br ${f.gradient} opacity-0 group-hover:opacity-[0.04] transition-opacity duration-500 pointer-events-none`}
              />

              <div
                className={`relative h-12 w-12 rounded-2xl bg-gradient-to-br ${f.gradient} flex items-center justify-center mb-4 shadow-lg ring-1 ring-white/15 group-hover:scale-110 group-hover:shadow-xl group-hover:ring-white/25 transition-all duration-300`}
              >
                <f.Icon className="h-6 w-6 text-white" />
              </div>

              <h3 className="relative text-lg font-semibold mb-2">{f.title}</h3>
              <p className="relative text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
