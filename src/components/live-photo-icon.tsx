"use client";

import * as React from "react";

interface LivePhotoIconProps {
  className?: string;
  size?: number;
}

/**
 * 苹果官方 LivePhoto 标识样式：
 * 中心实心圆 + 内环 + 外圈均匀分布的小圆点。
 * 默认 16×16，可通过 size 调整。
 */
export function LivePhotoIcon({ className, size = 16 }: LivePhotoIconProps) {
  const dotCount = 12;
  const outerR = size * 0.42;
  const dotR = size * 0.055;
  const center = size / 2;

  const dots = Array.from({ length: dotCount }, (_, i) => {
    const angle = (i * 360) / dotCount - 90;
    const rad = (angle * Math.PI) / 180;
    return {
      cx: center + outerR * Math.cos(rad),
      cy: center + outerR * Math.sin(rad),
    };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      {/* 外圈小圆点 */}
      {dots.map((d, i) => (
        <circle key={i} cx={d.cx} cy={d.cy} r={dotR} />
      ))}
      {/* 内环 */}
      <circle
        cx={center}
        cy={center}
        r={size * 0.22}
        fill="none"
        stroke="currentColor"
        strokeWidth={size * 0.075}
      />
      {/* 中心实心圆 */}
      <circle cx={center} cy={center} r={size * 0.11} />
    </svg>
  );
}
