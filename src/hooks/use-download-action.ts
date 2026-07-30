"use client";

import * as React from "react";
import { useSound } from "@/components/sound-manager";
import { toast } from "sonner";
import { triggerBlobDownload } from "@/lib/media-url";
import type { DownloadState } from "@/hooks/use-media-downloader";

export interface DownloadActionOptions {
  /** 下载地址（需已是代理/直链 URL） */
  url: string;
  /** 下载文件名 */
  filename: string;
  /** 成功时的 toast 提示文案 */
  successMessage: string;
  /** 失败时的 toast 提示文案（默认从 Error.message 或"下载失败"推导） */
  errorMessage?: string;
  /** 下载前校验，返回 false 则取消（不触发 sound/start） */
  shouldStart?: () => boolean;
  /** 自定义 fetch→blob 逻辑（默认为标准 fetch+res.blob） */
  fetchBlob?: (url: string) => Promise<Blob>;
  /** blob 最小体积校验（字节），默认 0 不校验 */
  minBlobSize?: number;
}

export interface DownloadActionResult {
  /** 当前下载状态 */
  state: DownloadState;
  /** 触发一次下载（幂等：downloading 中重复调用会被忽略） */
  execute: (options: DownloadActionOptions) => Promise<void>;
}

/**
 * 单次下载动作的状态机。
 *
 * 封装「sound 反馈 → 状态流转 → fetch→blob→triggerDownload → toast 提示 →
 * 自动 idle 重置」的完整流程。适用于任何需要展示下载进度按钮的场景。
 *
 * @example
 * ```tsx
 * const { state, execute } = useDownloadAction();
 *
 * <button disabled={state === "downloading"} onClick={() =>
 *   execute({ url, filename, successMessage: "下载完成" })
 * }>
 *   {state === "downloading" ? "..." : "下载"}
 * </button>
 * ```
 */
export function useDownloadAction(): DownloadActionResult {
  const [state, setState] = React.useState<DownloadState>("idle");
  const { play } = useSound();

  const execute = React.useCallback(
    async (opts: DownloadActionOptions) => {
      if (state === "downloading") return;
      if (opts.shouldStart && !opts.shouldStart()) return;

      play("start");
      setState("downloading");

      try {
        const blob = opts.fetchBlob
          ? await opts.fetchBlob(opts.url)
          : await (async () => {
              const res = await fetch(opts.url);
              if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`);
              return await res.blob();
            })();

        if (opts.minBlobSize && blob.size < opts.minBlobSize) {
          throw new Error("下载产物为空");
        }

        triggerBlobDownload(blob, opts.filename);
        setState("done");
        play("complete");
        toast.success(opts.successMessage);

        setTimeout(() => setState("idle"), 2000);
      } catch (err) {
        setState("idle");
        play("error");
        toast.error(opts.errorMessage ?? (err instanceof Error ? err.message : "下载失败"));
      }
    },
    [state, play]
  );

  return { state, execute };
}
