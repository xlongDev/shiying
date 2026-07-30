"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ClipboardPaste, X, Sparkles, Loader2 } from "lucide-react";
import { useSound } from "@/components/sound-manager";
import { toast } from "sonner";
import { useHistoryStore } from "@/store/history-store";

interface UrlInputProps {
  onParse: (url: string) => void;
  loading: boolean;
  /** 外部设置的初始值（如从历史记录回填） */
  externalUrl?: string;
}

export function UrlInput({ onParse, loading, externalUrl }: UrlInputProps) {
  const [url, setUrl] = React.useState("");
  const [isFocused, setIsFocused] = React.useState(false);
  const { play } = useSound();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const autoReadRef = React.useRef(false);

  // 当外部 URL 变化时（如点击历史记录），同步到输入框
  // 用正则提取纯 URL，去除分享文本等无关字符
  React.useEffect(() => {
    if (externalUrl && externalUrl !== url) {
      // 从文本中提取第一个 https?:// 开头的完整 URL
      const match = externalUrl.match(/(https?:\/\/[^\s<>"'）\】\},;]+)/);
      const cleaned = match ? match[1] : externalUrl;
      setUrl(cleaned);
    }
  }, [externalUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const containsVideoLink = (text: string): boolean => {
    const lower = text.toLowerCase();
    return (
      lower.includes("douyin.com") ||
      lower.includes("v.douyin.com") ||
      lower.includes("iesdouyin.com")
    );
  };

  /** 检查链接是否已在历史记录中 */
  const isInHistory = (text: string): boolean => {
    try {
      // 提取输入文本中的 URL
      const match = text.match(/https?:\/\/[^\s<>"']+/i);
      if (!match) return false;
      const inputUrl = match[0];
      // 检查历史记录中是否已有相同 URL
      const history = useHistoryStore.getState().items;
      return history.some((h) => h.url === inputUrl);
    } catch {
      return false;
    }
  };

  // 自动读取剪贴板
  React.useEffect(() => {
    if (autoReadRef.current) return;
    autoReadRef.current = true;

    const tryAutoRead = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && containsVideoLink(text.trim())) {
          // 检查是否已在历史记录中
          if (isInHistory(text.trim())) {
            return; // 已在历史记录中，不自动粘贴
          }
          setUrl(text.trim());
          play("paste");
          toast.success("检测到剪贴板链接，自动解析中...");
          setTimeout(() => onParse(text.trim()), 500);
        }
      } catch {
        // 用户未授权剪贴板权限，静默失败
      }
    };

    setTimeout(tryAutoRead, 800);
  }, [onParse, play]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const trimmed = text.trim();
        setUrl(trimmed);
        play("paste");
        if (containsVideoLink(trimmed)) {
          toast.success("已粘贴，自动解析中...");
          setTimeout(() => onParse(trimmed), 300);
        } else {
          toast.success("已粘贴");
        }
      }
    } catch {
      toast.error("无法读取剪贴板，请手动粘贴");
      inputRef.current?.focus();
    }
  };

  const handleClear = () => {
    setUrl("");
    play("click");
    inputRef.current?.focus();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      toast.error("请输入抖音链接");
      play("error");
      return;
    }
    play("click");
    onParse(url.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      handleSubmit(e);
    }
  };

  return (
    <motion.form
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4, duration: 0.5 }}
      className="w-full"
    >
      <div
        className={`relative flex items-center gap-2 glass-strong rounded-[2rem] p-2 transition-all duration-300 ${
          isFocused ? "ring-2 ring-primary/50 shadow-lg shadow-primary/20" : ""
        }`}
      >
        {/* 粘贴按钮 — 左侧圆形图标 */}
        <motion.button
          type="button"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={handlePaste}
          disabled={loading}
          className="flex-shrink-0 h-12 w-12 rounded-full glass glass-shine flex items-center justify-center disabled:opacity-50"
          aria-label="粘贴链接"
        >
          <ClipboardPaste className="h-5 w-5" />
        </motion.button>

        {/* 输入框 */}
        <div className="relative flex-1 min-w-0">
          <input
            ref={inputRef}
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder="粘贴抖音分享链接或文本..."
            disabled={loading}
            className="w-full h-12 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 disabled:opacity-50 pr-8"
          />
          {/* 清空按钮 — 绝对定位在输入框右侧 */}
          {url && !loading && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full glass flex items-center justify-center hover:bg-destructive/20 transition-colors"
              aria-label="清空"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* 解析按钮 */}
        <motion.button
          type="submit"
          disabled={loading || !url.trim()}
          whileHover={{ scale: loading ? 1 : 1.05 }}
          whileTap={{ scale: loading ? 1 : 0.95 }}
          className="flex-shrink-0 h-12 px-6 rounded-full btn-liquid text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2"
              >
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>解析中</span>
              </motion.div>
            ) : (
              <motion.div
                key="idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2"
              >
                <Sparkles className="h-5 w-5" />
                <span>开始解析</span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>
      </div>

      {/* 提示信息 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
      >
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-pink-500" />
          支持抖音视频/图集
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          可直接粘贴分享文本
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          无水印 · 高清 · 免费
        </span>
      </motion.div>
    </motion.form>
  );
}
