"use client";

import * as React from "react";

export interface UseImageSelection {
  /** 当前选中的图片索引集合 */
  selected: Set<number>;
  /** 直接设置集合（用于「默认全选」等副作用） */
  setSelected: React.Dispatch<React.SetStateAction<Set<number>>>;
  /** 切换单张选中状态 */
  toggle: (i: number) => void;
  /** 全选 / 取消全选（依据当前是否已全选） */
  toggleAll: (total: number) => void;
  /** 是否选中 */
  isSelected: (i: number) => boolean;
  /** 已选张数 */
  selectedCount: number;
}

/**
 * 管理图片画廊的选中状态（Set<number>）。
 * 纯状态 hook，不耦合音效 / UI，由调用方在 toggle 时自行触发 useSound。
 */
export function useImageSelection(): UseImageSelection {
  const [selected, setSelected] = React.useState<Set<number>>(new Set());

  const toggle = React.useCallback((i: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  const toggleAll = React.useCallback((total: number) => {
    setSelected((prev) => {
      if (prev.size === total) return new Set();
      return new Set(Array.from({ length: total }, (_, i) => i));
    });
  }, []);

  const isSelected = React.useCallback((i: number) => selected.has(i), [selected]);

  return { selected, setSelected, toggle, toggleAll, isSelected, selectedCount: selected.size };
}
