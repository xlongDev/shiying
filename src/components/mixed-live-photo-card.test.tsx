// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MixedLivePhotoCard } from "@/components/mixed-live-photo-card";
import type { LivePhotoInfo } from "@/lib/parser";

const livePhotos: LivePhotoInfo[] = [
  { imageUrl: "https://x/1.jpg", videoUrl: "https://x/1.mp4", musicUrl: "" },
  { imageUrl: "https://x/2.jpg", videoUrl: "https://x/2.mp4", musicUrl: "" },
  { imageUrl: "https://x/3.jpg", videoUrl: "https://x/3.mp4", musicUrl: "" },
];

type Props = Parameters<typeof MixedLivePhotoCard>[0];

function makeProps(overrides: Partial<Props> = {}): Props {
  return {
    livePhotos,
    selectedLiveIndex: 0,
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onSelectIndex: vi.fn(),
    batchOpen: false,
    onToggleBatch: vi.fn(),
    imageState: "idle",
    videoState: "idle",
    composeState: "idle",
    onDownloadSelectedImage: vi.fn(),
    onDownloadSelectedVideo: vi.fn(),
    onOpenComposeModal: vi.fn(),
    onDownloadLiveImages: vi.fn(),
    onDownloadLiveVideos: vi.fn(),
    onComposeMixedLive: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("MixedLivePhotoCard", () => {
  it("渲染标题与张数徽标", () => {
    render(<MixedLivePhotoCard {...makeProps()} />);
    expect(screen.getByText("实况照片")).toBeInTheDocument();
    expect(screen.getByText("3 张")).toBeInTheDocument();
  });

  it("上一张 / 下一张 调用对应回调", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<MixedLivePhotoCard {...makeProps({ onPrev, onNext })} />);
    fireEvent.click(screen.getByLabelText("上一张实况"));
    expect(onPrev).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("下一张实况"));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("点击缩略图触发 onSelectIndex(i)", () => {
    const onSelectIndex = vi.fn();
    render(<MixedLivePhotoCard {...makeProps({ onSelectIndex })} />);
    const thumb = screen.getByAltText("实况 3").closest("button");
    expect(thumb).not.toBeNull();
    fireEvent.click(thumb as HTMLElement);
    expect(onSelectIndex).toHaveBeenCalledWith(2);
  });

  it("批量下载切换按钮触发 onToggleBatch", () => {
    const onToggleBatch = vi.fn();
    render(<MixedLivePhotoCard {...makeProps({ onToggleBatch })} />);
    fireEvent.click(screen.getByText(/批量下载全部 3 张实况资源/));
    expect(onToggleBatch).toHaveBeenCalledTimes(1);
  });

  it("batchOpen=true 时展示批量操作按钮", () => {
    render(<MixedLivePhotoCard {...makeProps({ batchOpen: true })} />);
    expect(screen.getByText("全部原图")).toBeInTheDocument();
    expect(screen.getByText("全部短片")).toBeInTheDocument();
    expect(screen.getByText("全部实况")).toBeInTheDocument();
    expect(screen.getByText("快速合并")).toBeInTheDocument();
  });

  it("合成按钮触发 onOpenComposeModal", () => {
    const onOpenComposeModal = vi.fn();
    render(<MixedLivePhotoCard {...makeProps({ onOpenComposeModal })} />);
    fireEvent.click(screen.getByText(/合成实况视频/));
    expect(onOpenComposeModal).toHaveBeenCalledTimes(1);
  });
});
