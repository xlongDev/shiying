"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Clipboard, Scissors, Download } from "lucide-react";

const STEPS = [
  {
    icon: Clipboard,
    step: "01",
    title: "复制链接",
    desc: "在抖音中点击分享，复制视频或图文链接",
  },
  {
    icon: Scissors,
    step: "02",
    title: "粘贴解析",
    desc: "将链接粘贴到输入框，自动开始解析",
  },
  {
    icon: Download,
    step: "03",
    title: "下载保存",
    desc: "解析完成后，一键下载无水印视频或图片",
  },
];

export function StepsSection() {
  return (
    <section className="w-full py-16 sm:py-20 px-5 sm:px-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.6 }}
        className="text-center mb-12"
      >
        <h2 className="text-3xl sm:text-4xl font-bold mb-3">三步即可完成</h2>
        <p className="text-muted-foreground">简单到不需要教程</p>
      </motion.div>

      <div className="relative grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
        {/* 连接线 */}
        <div className="hidden md:block absolute top-12 left-[16%] right-[16%] h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

        {STEPS.map((s, i) => (
          <motion.div
            key={s.step}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{
              duration: 0.5,
              delay: i * 0.15,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="relative flex flex-col items-center text-center"
          >
            <div className="relative mb-5">
              <motion.div
                whileHover={{ scale: 1.1, rotate: 5 }}
                className="h-24 w-24 rounded-3xl glass-strong flex items-center justify-center relative z-10"
              >
                <s.icon className="h-10 w-10 text-primary" strokeWidth={1.8} />
              </motion.div>
              <span className="absolute -top-2 -right-2 h-8 w-8 rounded-full bg-gradient-to-br from-primary to-pink-500 text-white text-xs font-bold flex items-center justify-center z-20 shadow-lg">
                {s.step}
              </span>
            </div>
            <h3 className="text-lg font-semibold mb-2">{s.title}</h3>
            <p className="text-sm text-muted-foreground max-w-[240px] leading-relaxed">{s.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
