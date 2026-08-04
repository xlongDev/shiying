"use client";

import * as React from "react";
import { Loader2, ImageOff } from "lucide-react";
import { buildMediaProxyUrl } from "@/lib/media-url";
import { cn } from "@/lib/utils";

interface LazyImageProps {
  /** 上游原始图片 URL */
  src: string;
  /** 代理下载时使用的文件名 */
  filename: string;
  alt?: string;
  className?: string;
  /** 进入视口前的占位容器类名 */
  placeholderClassName?: string;
  /** 最大重试次数（含首次加载） */
  maxRetries?: number;
  /** 重试基础延迟（毫秒），按 2^attempt * baseDelay 指数退避 */
  retryBaseDelay?: number;
  /** 是否预加载（即使未进入视口也尝试加载，用于相邻图片） */
  eager?: boolean;
  onLoad?: () => void;
  onError?: () => void;
}

/**
 * 精确懒加载图片组件
 *
 * - 使用 IntersectionObserver 控制加载时机，避免不可见图片占用连接。
 * - 加载中显示骨架屏，失败自动重试（针对 429 / 网络抖动指数退避）。
 * - 支持 eager 模式，用于图片浏览器预加载相邻图片。
 */
export function LazyImage({
  src,
  filename,
  alt = "",
  className,
  placeholderClassName,
  maxRetries = 3,
  retryBaseDelay = 800,
  eager = false,
  onLoad,
  onError,
}: LazyImageProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = React.useState(eager);
  const [status, setStatus] = React.useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [retryKey, setRetryKey] = React.useState(0);
  const attemptRef = React.useRef(0);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const proxyUrl = React.useMemo(() => buildMediaProxyUrl(src, filename), [src, filename]);

  // 监听进入视口才触发真实加载
  React.useEffect(() => {
    if (eager || isVisible) return;
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setIsVisible(true);
        }
      },
      { root: null, rootMargin: "200px", threshold: 0 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [eager, isVisible]);

  // src / filename 变化时重置状态
  React.useEffect(() => {
    setStatus("idle");
    attemptRef.current = 0;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [src, filename]);

  const handleLoad = React.useCallback(() => {
    setStatus("loaded");
    attemptRef.current = 0;
    onLoad?.();
  }, [onLoad]);

  const handleError = React.useCallback(() => {
    if (attemptRef.current < maxRetries - 1) {
      attemptRef.current += 1;
      const delay = retryBaseDelay * 2 ** (attemptRef.current - 1);
      setStatus("loading");
      timeoutRef.current = setTimeout(() => {
        // 通过变更 key 强制 img 重新请求（cache buster 由代理 URL 不变、浏览器自行重试）
        setRetryKey((k) => k + 1);
      }, delay);
    } else {
      setStatus("error");
      onError?.();
    }
  }, [maxRetries, retryBaseDelay, onError]);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const showImage = isVisible || eager;

  return (
    <div
      ref={containerRef}
      className={cn("relative h-full w-full overflow-hidden", placeholderClassName)}
    >
      {showImage && (
        <img
          key={`${proxyUrl}-${retryKey}`}
          src={proxyUrl}
          alt={alt}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-300",
            status === "loaded" ? "opacity-100" : "opacity-0",
            className
          )}
          loading="lazy"
          decoding="async"
          onLoad={handleLoad}
          onError={handleError}
        />
      )}

      {/* 加载中 / 失败占位 */}
      {status !== "loaded" && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
          {status === "error" ? (
            <ImageOff className="h-5 w-5 text-muted-foreground/50" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
          )}
        </div>
      )}
    </div>
  );
}
