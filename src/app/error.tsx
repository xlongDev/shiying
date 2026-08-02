"use client";

import * as React from "react";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import Link from "next/link";

/**
 * 段级错误边界：捕获 src/app 页面子树（含客户端组件渲染）抛出的异常。
 * 自身刻意不依赖 framer-motion 等重依赖，避免"错误边界自身崩溃"的二次故障。
 * 注意：根布局(layout.tsx)自身的异常由 global-error.tsx 兜底。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // 生产环境可在此接入监控（Sentry / 自建上报）。
    // eslint-disable-next-line no-console
    console.error("[app/error] 页面渲染异常:", error);
  }, [error]);

  return (
    <main className="relative min-h-screen flex items-center justify-center px-5">
      <div className="glass-strong rounded-3xl p-8 w-full max-w-md text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-7 w-7 text-destructive" />
        </div>
        <h1 className="mb-2 text-xl font-semibold">页面出现了一点问题</h1>
        <p className="mb-1 text-sm text-muted-foreground">
          解析或渲染过程中发生了意外错误，您可以重试或返回首页。
        </p>
        {error.digest && (
          <p className="mb-5 break-all font-mono text-xs text-muted-foreground/70">
            Error ID: {error.digest}
          </p>
        )}
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-transform hover:scale-105"
          >
            <RotateCcw className="h-4 w-4" /> 重试
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full glass px-5 py-2.5 text-sm font-medium transition-transform hover:scale-105"
          >
            <Home className="h-4 w-4" /> 返回首页
          </Link>
        </div>
      </div>
    </main>
  );
}
