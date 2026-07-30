"use client";

import * as React from "react";
import { useSound } from "@/components/sound-manager";
import { toast } from "sonner";
import { buildMediaProxyUrl, sanitizeFilename, triggerBlobDownload } from "@/lib/media-url";

export type DownloadState = "idle" | "downloading" | "done";

export interface DownloadStatus {
  /** idle / downloading / done */
  state: DownloadState;
  /** video/music/zip 为 0-100 百分比；images 为已下载张数 */
  progress: number;
  /** images 模式下的总张数；其余模式为 0 */
  total: number;
}

const IDLE: DownloadStatus = { state: "idle", progress: 0, total: 0 };

export interface UseMediaDownloader {
  video: DownloadStatus;
  music: DownloadStatus;
  images: DownloadStatus;
  zip: DownloadStatus;
  /** 流式下载视频（带百分比进度） */
  downloadVideo: (url: string, filename: string) => Promise<void>;
  /** 流式下载音频（带百分比进度，校验空文件） */
  downloadMusic: (url: string, filename: string) => Promise<void>;
  /** 顺序下载多张图片（progress 为已下载张数，total 为总张数） */
  downloadImages: (urls: string[], desc: string) => Promise<void>;
  /** 动态 import jszip 打包多张图片为 ZIP（带百分比进度） */
  downloadZip: (urls: string[], zipName: string) => Promise<void>;
  /** 通用：直接对已有的 object URL 触发浏览器下载（调用方持有 object URL 生命周期） */
  triggerDownload: (blobUrl: string, filename: string) => void;
}

/**
 * 统一的媒体下载状态机：视频 / 音乐 / 图片 / ZIP 四路独立状态
 * （idle→downloading→done），封装 fetch 代理 URL、流式进度、jszip 打包、
 * blob→anchor 触发下载、sonner 提示与 useSound 音效。
 * 与具体业务解耦：调用方负责拼出最终下载 URL（含 musicUrl / 提取音频等分支判断）。
 */
export function useMediaDownloader(): UseMediaDownloader {
  const { play } = useSound();
  const [video, setVideo] = React.useState<DownloadStatus>(IDLE);
  const [music, setMusic] = React.useState<DownloadStatus>(IDLE);
  const [images, setImages] = React.useState<DownloadStatus>(IDLE);
  const [zip, setZip] = React.useState<DownloadStatus>(IDLE);

  const downloadVideo = React.useCallback(
    async (url: string, filename: string) => {
      play("start");
      setVideo({ state: "downloading", progress: 0, total: 0 });
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`);

        const contentLength = res.headers.get("content-length");
        const total = contentLength ? parseInt(contentLength) : 0;

        if (res.body && total > 0) {
          const reader = res.body.getReader();
          const chunks: BlobPart[] = [];
          let received = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              received += value.length;
              setVideo({
                state: "downloading",
                progress: Math.round((received / total) * 100),
                total: 0,
              });
            }
          }
          const blob = new Blob(chunks, { type: "video/mp4" });
          triggerBlobDownload(blob, filename);
        } else {
          const blob = await res.blob();
          triggerBlobDownload(blob, filename);
        }

        setVideo({ state: "done", progress: 100, total: 0 });
        play("complete");
        toast.success("视频下载完成");
        setTimeout(() => setVideo(IDLE), 2000);
      } catch (err) {
        setVideo(IDLE);
        play("error");
        toast.error(err instanceof Error ? err.message : "下载失败");
      }
    },
    [play]
  );

  const downloadMusic = React.useCallback(
    async (url: string, filename: string) => {
      play("start");
      setMusic({ state: "downloading", progress: 0, total: 0 });
      try {
        const res = await fetch(url);
        if (!res.ok) {
          let errMsg = `下载失败 (HTTP ${res.status})`;
          try {
            const errJson = await res.json();
            if (errJson && typeof errJson.error === "string") {
              errMsg = errJson.error;
            }
          } catch {
            const errText = await res.text().catch(() => "");
            if (errText.includes("ffmpeg")) {
              errMsg = "服务器未安装 ffmpeg，无法提取音频";
            }
          }
          throw new Error(errMsg);
        }

        const contentLength = res.headers.get("content-length");
        const total = contentLength ? parseInt(contentLength) : 0;
        let blob: Blob;

        if (res.body && total > 0) {
          const reader = res.body.getReader();
          const chunks: BlobPart[] = [];
          let received = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              received += value.length;
              setMusic({
                state: "downloading",
                progress: Math.round((received / total) * 100),
                total: 0,
              });
            }
          }
          blob = new Blob(chunks, { type: "audio/mp4" });
        } else {
          blob = await res.blob();
        }

        if (blob.size < 1000) {
          throw new Error("音频文件为空，该视频可能没有音轨");
        }

        triggerBlobDownload(blob, filename);
        setMusic({ state: "done", progress: 100, total: 0 });
        play("complete");
        toast.success("音乐下载完成");
        setTimeout(() => setMusic(IDLE), 2000);
      } catch (err) {
        setMusic(IDLE);
        play("error");
        toast.error(err instanceof Error ? err.message : "音乐下载失败");
      }
    },
    [play]
  );

  const downloadImages = React.useCallback(
    async (urls: string[], desc: string) => {
      play("start");
      setImages({ state: "downloading", progress: 0, total: 0 });
      if (urls.length === 0) {
        toast.error("请至少选择一张图片");
        setImages(IDLE);
        return;
      }
      setImages({ state: "downloading", progress: 0, total: urls.length });
      try {
        for (let i = 0; i < urls.length; i++) {
          const proxyUrl = buildMediaProxyUrl(urls[i], `image_${i + 1}.jpg`);
          const res = await fetch(proxyUrl);
          if (!res.ok) throw new Error(`图片 ${i + 1} 下载失败`);
          const blob = await res.blob();
          triggerBlobDownload(blob, `${sanitizeFilename(desc)}_${i + 1}.jpg`);
          setImages({ state: "downloading", progress: i + 1, total: urls.length });
          await new Promise((r) => setTimeout(r, 300));
        }
        setImages({ state: "done", progress: urls.length, total: urls.length });
        play("complete");
        toast.success(`已下载 ${urls.length} 张图片`);
        setTimeout(() => setImages(IDLE), 2000);
      } catch (err) {
        setImages(IDLE);
        play("error");
        toast.error(err instanceof Error ? err.message : "下载失败");
      }
    },
    [play]
  );

  const downloadZip = React.useCallback(
    async (urls: string[], zipName: string) => {
      play("start");
      setZip({ state: "downloading", progress: 0, total: 0 });
      if (urls.length === 0) {
        toast.error("请至少选择一张图片");
        setZip(IDLE);
        return;
      }
      try {
        const JSZip = (await import("jszip")).default;
        const zipFile = new JSZip();
        for (let i = 0; i < urls.length; i++) {
          const proxyUrl = buildMediaProxyUrl(urls[i], `image_${i + 1}.jpg`);
          const res = await fetch(proxyUrl);
          if (!res.ok) throw new Error(`图片 ${i + 1} 下载失败`);
          const blob = await res.blob();
          zipFile.file(`image_${i + 1}.jpg`, blob);
          setZip({
            state: "downloading",
            progress: Math.round(((i + 1) / urls.length) * 100),
            total: 0,
          });
        }
        const zipBlob = await zipFile.generateAsync({ type: "blob" });
        triggerBlobDownload(zipBlob, zipName);
        setZip({ state: "done", progress: 100, total: 0 });
        play("complete");
        toast.success("ZIP 打包下载完成");
        setTimeout(() => setZip(IDLE), 2000);
      } catch (err) {
        setZip(IDLE);
        play("error");
        toast.error(err instanceof Error ? err.message : "打包失败");
      }
    },
    [play]
  );

  const triggerDownload = React.useCallback((blobUrl: string, filename: string) => {
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  return {
    video,
    music,
    images,
    zip,
    downloadVideo,
    downloadMusic,
    downloadImages,
    downloadZip,
    triggerDownload,
  };
}
