// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAppleLivePhoto } from "./use-apple-live-photo";
import type { LivePhotoInfo } from "@/lib/parser";

const livePhotos: LivePhotoInfo[] = [
  { imageUrl: "https://x/1.jpg", videoUrl: "https://x/1.mp4", musicUrl: "" },
  { imageUrl: "https://x/2.jpg", videoUrl: "https://x/2.mp4", musicUrl: "" },
];

const downloads: { blob: Blob; filename: string }[] = [];

vi.mock("@/lib/image-to-jpeg", () => ({
  fetchCoverAsJpeg: vi.fn(async (url: string) => new Blob([url], { type: "image/jpeg" })),
}));

vi.mock("@/lib/media-url", async () => {
  const actual = await vi.importActual<typeof import("@/lib/media-url")>("@/lib/media-url");
  return {
    ...actual,
    triggerBlobDownload: vi.fn((blob: Blob, filename: string) => {
      downloads.push({ blob, filename });
    }),
  };
});

describe("useAppleLivePhoto", () => {
  beforeEach(() => {
    downloads.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input, init) => {
        // 从 multipart body 读出 filename，模拟服务端按表单字段命名 ZIP
        const form = init?.body as FormData | undefined;
        const filename = (form?.get("filename")?.toString() || "live_photo").replace(/"/g, "");
        const headers = new Headers();
        headers.set(
          "content-disposition",
          `attachment; filename="${filename}_apple_live_photo.zip"`
        );
        return {
          ok: true,
          status: 200,
          blob: async () => new Blob(["zip"], { type: "application/zip" }),
          headers,
          json: async () => ({}),
        } as Response;
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("create 单张成功会触发下载并进入 done", async () => {
    const { result } = renderHook(() => useAppleLivePhoto());
    await act(async () => {
      await result.current.create(livePhotos[0]);
    });
    expect(result.current.state).toBe("done");
    expect(downloads).toHaveLength(1);
  });

  it("createBatch 空数组直接返回且状态保持 idle", async () => {
    const { result } = renderHook(() => useAppleLivePhoto());
    await act(async () => {
      await result.current.createBatch([]);
    });
    expect(result.current.state).toBe("idle");
    expect(downloads).toHaveLength(0);
  });

  it("createBatch 按并发打包全部实况并触发多张下载", async () => {
    const { result } = renderHook(() => useAppleLivePhoto());
    await act(async () => {
      await result.current.createBatch(livePhotos, "live_photo");
    });
    expect(result.current.state).toBe("done");
    expect(downloads).toHaveLength(2);
    expect(downloads[0].filename).toMatch(/live_photo_1_apple_live_photo\.zip$/);
    expect(downloads[1].filename).toMatch(/live_photo_2_apple_live_photo\.zip$/);
  });

  it("createBatch 会逐步更新 batchProgress", async () => {
    const { result } = renderHook(() => useAppleLivePhoto());
    act(() => {
      result.current.createBatch(livePhotos);
    });
    await waitFor(() => expect(result.current.batchProgress?.total).toBe(2));
    await waitFor(() => expect(result.current.state).toBe("done"));
    expect(result.current.batchProgress?.current).toBe(2);
  });

  it("服务端返回非 200 时进入 error 并保留错误文案", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 500,
            json: async () => ({ error: "服务器繁忙" }),
          }) as Response
      )
    );
    const { result } = renderHook(() => useAppleLivePhoto());
    await act(async () => {
      await result.current.create(livePhotos[0]);
    });
    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("服务器繁忙");
  });
});
