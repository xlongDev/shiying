"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useSound } from "@/components/sound-manager";

const FAQ_ITEMS = [
  {
    q: "支持哪些链接？",
    a: "支持抖音 App 分享链接（可直接粘贴完整分享文本，自动提取链接）、抖音网页链接（www.douyin.com/video/xxx）、抖音图文链接。",
  },
  {
    q: "可以直接粘贴分享文本吗？",
    a: "可以。直接粘贴抖音 App 中「复制链接」得到的完整文本即可，系统会自动提取其中的视频链接进行解析。粘贴后自动开始解析，无需手动点击。",
  },
  {
    q: "下载的视频是高清的吗？",
    a: "是的，我们获取的是平台原始无水印视频流，画质与原视频一致。部分老视频可能只有标清源。",
  },
  {
    q: "图文帖子怎么下载？",
    a: "图文帖子会自动识别并显示图片列表，支持逐张选择下载或打包成 ZIP 下载。图片均为无水印高清原图。",
  },
  {
    q: "实况图片和图文合成视频？",
    a: "实况图片（Live Photo）已支持下载：可分别下载静态高清原图（JPG）、无水印动态短片（MP4）和配套背景音乐（M4A），并支持将短片与 BGM 合并输出完整带音乐视频。图文帖子支持一键合成为 MP4 视频：选择喜欢的图片并配合原帖音乐即可生成，支持在线预览和下载。",
  },
  {
    q: "隐私安全如何保障？",
    a: "解析过程在服务端实时进行，不存储任何视频数据、用户链接或个人信息。每次请求完成后数据即被销毁，无日志记录。",
  },
  {
    q: "音效可以关闭吗？",
    a: "可以。点击右上角的音效按钮，可一键开关音效并调节音量，设置会自动保存。",
  },
];

function FaqItem({ item }: { item: { q: string; a: string } }) {
  const [open, setOpen] = React.useState(false);
  const { play } = useSound();

  return (
    <div className="glass rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          play("click");
        }}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <span className="text-sm font-medium">{item.q}</span>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.3 }}>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <p className="px-5 pb-4 text-sm text-muted-foreground leading-relaxed">{item.a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function FaqSection() {
  return (
    <section className="mx-auto max-w-3xl px-5 sm:px-8 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="text-center mb-8"
      >
        <h2 className="text-2xl sm:text-3xl font-bold mb-2">常见问题</h2>
        <p className="text-sm text-muted-foreground">点击展开查看</p>
      </motion.div>

      <div className="space-y-3">
        {FAQ_ITEMS.map((item, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.05, duration: 0.4 }}
          >
            <FaqItem item={item} />
          </motion.div>
        ))}
      </div>
    </section>
  );
}
