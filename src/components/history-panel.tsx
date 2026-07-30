"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { History, Trash2, X } from "lucide-react";
import { useSound } from "@/components/sound-manager";
import { useHistoryStore } from "@/store/history-store";

interface HistoryPanelProps {
  onSelect: (url: string) => void;
}

export function HistoryPanel({ onSelect }: HistoryPanelProps) {
  const [open, setOpen] = React.useState(false);
  const items = useHistoryStore((s) => s.items);
  const removeItem = useHistoryStore((s) => s.remove);
  const clearAll = useHistoryStore((s) => s.clear);
  const { play } = useSound();
  const ref = React.useRef<HTMLDivElement>(null);

  // 点击外部关闭
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const clearHistory = () => {
    clearAll();
    play("click");
  };

  const handleSelect = (url: string) => {
    onSelect(url);
    setOpen(false);
    play("click");
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeItem(id);
    play("click");
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          play("click");
          setOpen(!open);
        }}
        className="h-10 w-10 rounded-full glass glass-shine flex items-center justify-center"
        aria-label="历史记录"
        title="历史记录"
      >
        <History className="h-5 w-5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute right-0 top-12 z-50 w-80 max-h-96 glass-strong rounded-2xl p-4 shadow-xl overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">历史记录</span>
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={clearHistory}
                  className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1"
                >
                  <Trash2 className="h-3 w-3" />
                  清空
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
              {items.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">暂无历史记录</div>
              ) : (
                items.map((item) => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    onClick={() => handleSelect(item.url)}
                    className="glass rounded-xl p-2.5 cursor-pointer hover:bg-primary/10 transition-colors group"
                  >
                    <div className="flex gap-2.5">
                      {item.video.cover && (
                        <img
                          src={item.video.cover}
                          alt=""
                          className="h-12 w-12 rounded-lg object-cover flex-shrink-0"
                          loading="lazy"
                          decoding="async"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">
                          {item.video.desc || "无描述"}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {item.video.author.name} ·{" "}
                          {new Date(item.timestamp).toLocaleString("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(item.id, e)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      >
                        <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
