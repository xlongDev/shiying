"use client";

import * as React from "react";

export interface UseResultModals {
  /** 视频预览弹窗是否打开 */
  showVideoPreview: boolean;
  /** 图文视频合成弹窗是否打开 */
  showComposeModal: boolean;
  /** 图片浏览器初始索引；null 表示关闭 */
  viewerIndex: number | null;
  openVideoPreview: () => void;
  closeVideoPreview: () => void;
  openComposeModal: () => void;
  closeComposeModal: () => void;
  openViewer: (i: number) => void;
  closeViewer: () => void;
}

/**
 * 管理主结果卡片中的三类弹窗/浏览器可见性状态：
 * 视频预览、图文合成弹窗、图片大图画廊。
 */
export function useResultModals(): UseResultModals {
  const [showVideoPreview, setShowVideoPreview] = React.useState(false);
  const [showComposeModal, setShowComposeModal] = React.useState(false);
  const [viewerIndex, setViewerIndex] = React.useState<number | null>(null);

  return {
    showVideoPreview,
    showComposeModal,
    viewerIndex,
    openVideoPreview: React.useCallback(() => setShowVideoPreview(true), []),
    closeVideoPreview: React.useCallback(() => setShowVideoPreview(false), []),
    openComposeModal: React.useCallback(() => setShowComposeModal(true), []),
    closeComposeModal: React.useCallback(() => setShowComposeModal(false), []),
    openViewer: React.useCallback((i: number) => setViewerIndex(i), []),
    closeViewer: React.useCallback(() => setViewerIndex(null), []),
  };
}
