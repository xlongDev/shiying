/**
 * 解析历史记录集中存储（zustand + persist）
 *
 * - 替代原先散落在 use-parse-video / history-panel / url-input 中的
 *   原始 localStorage 读写（key: "parse-history"）。
 * - 写入时对 ParsedVideo 做瘦身：仅剔除 `raw` 等巨型字段（保留全部必需字段，
 *   保证类型与 ParsedVideo 完全一致，历史面板/回填仅需 cover/desc/author/url）。
 * - 旧版本数据（"parse-history"）在 store 创建时一次性迁移到新 key。
 *
 * 行为等价约束：
 * - 按 awemeId 去重，最新置前。
 * - 上限 20 条。
 * - 解析成功后写入「基础信息即可」（与旧逻辑一致）。
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ParsedVideo } from "@/lib/parser";

export interface HistoryItem {
  id: string;
  url: string;
  video: ParsedVideo;
  timestamp: number;
}

interface HistoryState {
  items: HistoryItem[];
  add: (url: string, video: ParsedVideo) => void;
  remove: (id: string) => void;
  clear: () => void;
}

const LEGACY_KEY = "parse-history";
const PERSIST_KEY = "shiying-parse-history-v2";
const MAX_ITEMS = 20;

/**
 * 剔除会撑爆 localStorage 的巨型字段（raw 等）。
 * 仅删除 raw，其余字段（含必需的 videoUrl/author 等）原样保留，
 * 保证返回值类型仍满足 ParsedVideo。
 */
function slim(video: ParsedVideo): ParsedVideo {
  const { raw: _raw, ...rest } = video;
  void _raw;
  return rest;
}

/**
 * 生成唯一 id。crypto.randomUUID 仅在安全上下文（https/localhost）可用，
 * 普通 http 下回退到时间戳 + 随机串，避免 add() 抛错导致历史写入失败。
 */
function makeId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 读取旧版本 localStorage 数据并迁移到新 store。
 * 读取后删除旧 key，保证只迁移一次。失败则静默返回空数组。
 */
function importLegacyHistory(): HistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(LEGACY_KEY);
    if (!stored) return [];
    const legacy = JSON.parse(stored) as HistoryItem[];
    const migrated = Array.isArray(legacy)
      ? legacy.filter((h) => h && h.video).map((h) => ({ ...h, video: slim(h.video) }))
      : [];
    window.localStorage.removeItem(LEGACY_KEY);
    return migrated;
  } catch {
    return [];
  }
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (url, video) => {
        const slimmed = slim(video);
        const filtered = get().items.filter((h) => h.video.awemeId !== slimmed.awemeId);
        const item: HistoryItem = {
          id: makeId(),
          url,
          video: slimmed,
          timestamp: Date.now(),
        };
        set({ items: [item, ...filtered].slice(0, MAX_ITEMS) });
      },
      remove: (id) => {
        set({ items: get().items.filter((h) => h.id !== id) });
      },
      clear: () => set({ items: [] }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ items: state.items }),
    }
  )
);

// 模块级：store 创建后执行一次旧数据迁移（仅客户端）。
// 将 "parse-history" 中的历史合并进新 store 并持久化到 PERSIST_KEY。
if (typeof window !== "undefined") {
  const legacy = importLegacyHistory();
  if (legacy.length > 0) {
    useHistoryStore.setState((s) => {
      const seen = new Set(s.items.map((h) => h.video.awemeId));
      const merged = [...s.items];
      for (const item of legacy) {
        if (!seen.has(item.video.awemeId)) {
          merged.push(item);
          seen.add(item.video.awemeId);
        }
      }
      return { items: merged.slice(0, MAX_ITEMS) };
    });
  }
}
