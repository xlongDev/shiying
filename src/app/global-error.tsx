"use client";

import * as React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * 根布局级错误边界：仅当根 layout.tsx 自身渲染失败时触发。
 * 此时整棵 React 树（含 ThemeProvider）已不可用，必须自行渲染 <html><body>，
 * 且不能用依赖于 CSS 变量的玻璃主题类，改用内联样式保证绝对可渲染。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // 根布局崩溃时无法走统一 logger，直接输出便于排障。
    // eslint-disable-next-line no-console
    console.error("[app/global-error] 根布局异常:", error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#0a0a14",
          color: "#e5e5e5",
          padding: "1.5rem",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            padding: "2rem",
            borderRadius: "1.5rem",
            textAlign: "center",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
          <div
            style={{
              margin: "0 auto 1.25rem",
              height: 56,
              width: 56,
              borderRadius: "9999px",
              background: "rgba(220,38,38,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <AlertTriangle style={{ height: 28, width: 28, color: "#ef4444" }} />
          </div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            应用初始化失败
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#a3a3a3", margin: "0 0 1.5rem" }}>
            根布局加载时出现严重错误，请重试。
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              borderRadius: "9999px",
              background: "#d6336c",
              color: "#fff",
              padding: "0.625rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
            }}
          >
            <RotateCcw style={{ height: 16, width: 16 }} /> 重试
          </button>
        </div>
      </body>
    </html>
  );
}
