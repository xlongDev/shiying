"use client";

import * as React from "react";

export function AuroraBackground() {
  return (
    <div className="aurora" aria-hidden>
      <div className="aurora-blob aurora-blob-1" />
      <div className="aurora-blob aurora-blob-2" />
      <div className="aurora-blob aurora-blob-3" />
      {/* 网格纹理叠加 */}
      <div className="absolute inset-0 grid-bg opacity-40" />
      {/* 顶部渐隐 */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background/60" />
    </div>
  );
}
