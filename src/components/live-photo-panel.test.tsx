// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LivePhotoPanel } from "@/components/live-photo-panel";
import type { ParsedVideo } from "@/lib/parser";

const base: ParsedVideo = {
  platform: "douyin",
  awemeId: "1",
  desc: "测试标题",
  author: { name: "author", avatar: "https://x/y.jpg" },
  cover: "https://x/c.jpg",
  videoUrl: "https://x/v.mp4",
};

const noop = () => {};

afterEach(cleanup);

describe("LivePhotoPanel 分支渲染", () => {
  it("livePhotoPending → 渲染探测中面板", () => {
    render(
      <LivePhotoPanel video={{ ...base, livePhotoPending: true }} onOpenComposeModal={noop} />
    );
    expect(screen.getByText("正在探测实况照片")).toBeInTheDocument();
  });

  it("livePhotoFailed + onRetryLivePhoto → 渲染失败面板并触发重试", () => {
    const onRetry = vi.fn();
    render(
      <LivePhotoPanel
        video={{ ...base, livePhotoFailed: true }}
        onOpenComposeModal={noop}
        onRetryLivePhoto={onRetry}
      />
    );
    expect(screen.getByText("实况照片探测未完成")).toBeInTheDocument();
    fireEvent.click(screen.getByText("重新探测实况照片"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("isLivePhoto → 渲染单图实况卡片（1 张）", () => {
    render(
      <LivePhotoPanel
        video={{
          ...base,
          isLivePhoto: true,
          livePhoto: { imageUrl: "https://x/i.jpg", videoUrl: "https://x/v.mp4", musicUrl: "" },
        }}
        onOpenComposeModal={noop}
      />
    );
    expect(screen.getByText("实况照片")).toBeInTheDocument();
    expect(screen.getByText("1 张")).toBeInTheDocument();
  });

  it("isMixedLivePhoto → 渲染混合实况卡片（N 张）", () => {
    const livePhotos = [
      { imageUrl: "https://x/1.jpg", videoUrl: "https://x/1.mp4", musicUrl: "" },
      { imageUrl: "https://x/2.jpg", videoUrl: "https://x/2.mp4", musicUrl: "" },
      { imageUrl: "https://x/3.jpg", videoUrl: "https://x/3.mp4", musicUrl: "" },
    ];
    render(
      <LivePhotoPanel
        video={{ ...base, isMixedLivePhoto: true, livePhotos }}
        onOpenComposeModal={noop}
      />
    );
    expect(screen.getByText("实况照片")).toBeInTheDocument();
    expect(screen.getByText("3 张")).toBeInTheDocument();
  });
});
