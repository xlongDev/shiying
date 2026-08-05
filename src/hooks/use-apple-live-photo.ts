"use client";

import * as React from "react";
import { triggerBlobDownload } from "@/lib/media-url";
import { fetchCoverAsJpeg } from "@/lib/image-to-jpeg";
import type { LivePhotoInfo } from "@/lib/parser";

export type AppleLivePhotoState = "idle" | "preparing" | "downloading" | "done" | "error";

export interface BatchProgress {
  current: number;
  total: number;
}

/**
 * 调用 /api/live-photo/apple 把实况图打包成苹果 Live Photo（.pvt ZIP）并触发下载。
 *
 * 与服务端纯下载状态机解耦：本 hook 自管 loading/error，UI 独立渲染按钮与进度。
 *
 * 封面 WebP → JPEG 的转码在浏览器里用 canvas 做完再上传，服务端因此不需要任何
 * 外部依赖（装不装 ffmpeg 都能打包）。转码失败不阻断：退回让服务端自己拉取。
 */
export function useAppleLivePhoto() {
  const [state, setState] = React.useState<AppleLivePhotoState>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [batchProgress, setBatchProgress] = React.useState<BatchProgress | null>(null);

  const reset = React.useCallback(() => {
    setState("idle");
    setError(null);
    setBatchProgress(null);
  }, []);

  const uploadOne = React.useCallback(
    async (lp: LivePhotoInfo, coverJpeg: Blob | null, filename?: string) => {
      const form = new FormData();
      form.append("imageUrl", lp.imageUrl);
      form.append("videoUrl", lp.videoUrl);
      if (coverJpeg) form.append("cover", coverJpeg, "cover.jpg");
      if (filename) form.append("filename", filename);

      const res = await fetch("/api/live-photo/apple", { method: "POST", body: form });

      if (!res.ok) {
        let msg = `打包失败（HTTP ${res.status}）`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          // 响应体非 JSON，沿用默认文案
        }
        throw new Error(msg);
      }

      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const rawName = cd.split("filename=")[1]?.replace(/["]/g, "");
      const outName = rawName ? decodeURIComponent(rawName) : "apple_live_photo.zip";
      triggerBlobDownload(blob, outName);
    },
    []
  );

  const create = React.useCallback(
    async (lp: LivePhotoInfo, filename?: string) => {
      setState("preparing");
      setError(null);
      setBatchProgress(null);
      try {
        let coverJpeg: Blob | null = null;
        try {
          coverJpeg = await fetchCoverAsJpeg(lp.imageUrl);
        } catch {
          coverJpeg = null;
        }

        setState("downloading");
        await uploadOne(lp, coverJpeg, filename);
        setState("done");
      } catch (e) {
        setError(e instanceof Error ? e.message : "未知错误");
        setState("error");
      }
    },
    [uploadOne]
  );

  const createBatch = React.useCallback(
    async (livePhotos: LivePhotoInfo[], filenameBase?: string) => {
      if (livePhotos.length === 0) return;
      setState("preparing");
      setError(null);
      setBatchProgress({ current: 0, total: livePhotos.length });
      try {
        // 先并行把所有封面 WebP → JPEG 转好，避免后续串行时反复等待 canvas
        const covers = await Promise.all(
          livePhotos.map(async (lp) => {
            try {
              return await fetchCoverAsJpeg(lp.imageUrl);
            } catch {
              return null;
            }
          })
        );

        setState("downloading");
        // 限制并发数，避免一次性打爆后端与浏览器下载队列
        const CONCURRENCY = 2;
        let nextIndex = 0;
        async function worker() {
          while (nextIndex < livePhotos.length) {
            const i = nextIndex++;
            const lp = livePhotos[i];
            const cover = covers[i];
            const filename = filenameBase ? `${filenameBase}_${i + 1}` : undefined;
            await uploadOne(lp, cover, filename);
            setBatchProgress((prev) => ({
              current: (prev?.current ?? 0) + 1,
              total: livePhotos.length,
            }));
          }
        }
        await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
        setState("done");
      } catch (e) {
        setError(e instanceof Error ? e.message : "未知错误");
        setState("error");
      }
    },
    [uploadOne]
  );

  return { state, error, create, createBatch, reset, batchProgress };
}
