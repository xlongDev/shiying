"use client";

import * as React from "react";

export interface UseLivePhotoViewState {
  /** 混合实况中当前选中的实况图片索引 */
  selectedLiveIndex: number;
  setSelectedLiveIndex: React.Dispatch<React.SetStateAction<number>>;
  /** 批量下载区域展开态 */
  batchOpen: boolean;
  setBatchOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /** 上一张（循环） */
  prev: (total: number) => void;
  /** 下一张（循环） */
  next: (total: number) => void;
}

/**
 * 管理实况照片面板内的视图状态：
 * - selectedLiveIndex：混合实况下切换预览哪一张实况
 * - batchOpen：批量下载区域展开/收起
 */
export function useLivePhotoViewState(): UseLivePhotoViewState {
  const [selectedLiveIndex, setSelectedLiveIndex] = React.useState(0);
  const [batchOpen, setBatchOpen] = React.useState(false);

  const prev = React.useCallback((total: number) => {
    setSelectedLiveIndex((p) => (p === 0 ? total - 1 : p - 1));
  }, []);

  const next = React.useCallback((total: number) => {
    setSelectedLiveIndex((p) => (p + 1) % total);
  }, []);

  return { selectedLiveIndex, setSelectedLiveIndex, batchOpen, setBatchOpen, prev, next };
}
