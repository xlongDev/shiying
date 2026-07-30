"use client";

import * as React from "react";
import { useSound } from "@/components/sound-manager";
import { toast } from "sonner";
import type { ParsedVideo } from "@/lib/parser";
import { useHistoryStore } from "@/store/history-store";
import { logger } from "@/lib/logger";

export interface UseParseVideo {
  loading: boolean;
  video: ParsedVideo | null;
  lastUrl: string;
  handleParse: (url: string) => Promise<void>;
  retryLivePhoto: (base: ParsedVideo) => Promise<void>;
}

/**
 * 解析编排 hook：
 * - 第一阶段 POST /api/parse（skipLivePhoto）快速拿基础信息
 * - 写入 zustand 历史 store
 * - 第二阶段（如有实况待解析）异步 POST /api/parse-live-photo 补全实况资源
 * 第二阶段逻辑可被初始解析与「重试」按钮复用。
 */
export function useParseVideo(resultRef?: React.RefObject<HTMLDivElement | null>): UseParseVideo {
  const [loading, setLoading] = React.useState(false);
  const [video, setVideo] = React.useState<ParsedVideo | null>(null);
  const [lastUrl, setLastUrl] = React.useState("");
  const { play } = useSound();

  const resolveLivePhotos = React.useCallback(async (base: ParsedVideo) => {
    try {
      // silent=true 表示多图 note 的静默后台探测：失败时不展示「探测未完成」面板，
      // 仅静默降级为普通图文（避免对不含实况的普通帖子误报）。
      const silent = !!base.livePhotoBackground;
      const isSlides = base.contentType === "slides";
      const isSingleNote = base.contentType === "note" && !!base.images && base.images.length === 1;
      const isMultiNote = base.contentType === "note" && !!base.images && base.images.length > 1;

      if (isSlides || isMultiNote) {
        const liveRes = await fetch("/api/parse-live-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "slides",
            awemeId: base.awemeId,
            imageUrls: base.images,
            musicUrl: base.musicUrl || "",
          }),
        });
        const liveData = await liveRes.json();
        if (
          liveData.ok &&
          liveData.data &&
          (liveData.data.isMixedLivePhoto || liveData.data.isLivePhoto)
        ) {
          setVideo({
            ...base,
            ...liveData.data,
            livePhotoPending: false,
            livePhotoBackground: false,
            livePhotoFailed: false,
          });
          return;
        }
      } else if (isSingleNote) {
        const liveRes = await fetch("/api/parse-live-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "single",
            awemeId: base.awemeId,
            imageUrl: base.images?.[0] || base.cover,
            musicUrl: base.musicUrl || "",
          }),
        });
        const liveData = await liveRes.json();
        if (liveData.ok && liveData.data && liveData.data.isLivePhoto) {
          setVideo({
            ...base,
            ...liveData.data,
            livePhotoPending: false,
            livePhotoBackground: false,
            livePhotoFailed: false,
          });
          return;
        }
      }

      // 探测成功但未获取到实况 → 静默模式直接降级，非静默模式展示「重试」入口
      if (silent) {
        setVideo({
          ...base,
          livePhotoPending: false,
          livePhotoBackground: false,
          livePhotoFailed: false,
        });
      } else {
        setVideo({
          ...base,
          livePhotoPending: false,
          livePhotoBackground: false,
          livePhotoFailed: true,
        });
      }
    } catch (err) {
      logger.warn("live-photo", "异步实况解析失败:", err);
      // 静默模式：catch 也仅降级；非静默模式：标记失败（展示重试入口）
      if (base.livePhotoBackground) {
        setVideo({
          ...base,
          livePhotoPending: false,
          livePhotoBackground: false,
          livePhotoFailed: false,
        });
      } else {
        setVideo({
          ...base,
          livePhotoPending: false,
          livePhotoBackground: false,
          livePhotoFailed: true,
        });
      }
    }
  }, []);

  const handleParse = React.useCallback(
    async (url: string) => {
      setLoading(true);
      setVideo(null);
      setLastUrl(url);

      try {
        // 第一阶段：快速获取基础信息（跳过实况解析）
        const res = await fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, skipLivePhoto: true }),
        });
        const data = await res.json();

        if (!data.ok) {
          throw new Error(data.error ?? "解析失败");
        }

        const baseResult = data.data as ParsedVideo;
        setVideo(baseResult);
        setLoading(false);
        play("success");

        // 保存到历史记录（基础信息即可）
        try {
          useHistoryStore.getState().add(url, baseResult);
        } catch {
          /* ignore history store failures */
        }

        setTimeout(() => {
          resultRef?.current?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }, 100);

        // 第二阶段：如果有实况照片待解析，异步获取实况资源
        // （livePhotoPending=骨架屏探测；livePhotoBackground=多图 note 静默后台探测）
        if (baseResult.livePhotoPending || baseResult.livePhotoBackground) {
          await resolveLivePhotos(baseResult);
        }
      } catch (err) {
        play("error");
        const msg = err instanceof Error ? err.message : "解析失败，请稍后重试";
        toast.error(msg);
        setLoading(false);
      }
    },
    [play, resolveLivePhotos, resultRef]
  );

  return { loading, video, lastUrl, handleParse, retryLivePhoto: resolveLivePhotos };
}
