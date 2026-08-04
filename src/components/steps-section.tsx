"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Clipboard, Scissors, Download } from "lucide-react";
import { revealContainer, revealItem } from "@/lib/motion";

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
        variants={revealContainer}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-80px" }}
        className="text-center mb-12"
      >
        <motion.div variants={revealItem}>
          <h2 className="text-3xl sm:text-4xl font-bold mb-3">三步即可完成</h2>
          <p className="text-muted-foreground">简单到不需要教程</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto mt-4">
          {STEPS.map((s) => (
            <motion.div
              key={s.step}
              variants={revealItem}
              whileHover={{ y: -6 }}
              className="relative flex flex-col items-center text-center"
            >
              <div className="relative mb-5">
                <motion.div
                  whileHover={{ scale: 1.08, rotate: 5 }}
                  className="h-24 w-24 rounded-3xl glass flex items-center justify-center relative z-10 border border-white/15"
                >
                  <s.icon className="h-10 w-10 text-primary" strokeWidth={1.8} />
                </motion.div>
                <motion.span
                  initial={{ scale: 0 }}
                  whileInView={{ scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ type: "spring", stiffness: 320, damping: 18, delay: 0.35 }}
                  className="absolute -top-2 -right-2 h-8 w-8 rounded-full bg-gradient-to-br from-primary to-pink-500 text-white text-xs font-bold flex items-center justify-center z-20 shadow-lg"
                >
                  {s.step}
                </motion.span>
              </div>
              <h3 className="text-lg font-semibold mb-2">{s.title}</h3>
              <p className="text-sm text-muted-foreground max-w-[240px] leading-relaxed">
                {s.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}
