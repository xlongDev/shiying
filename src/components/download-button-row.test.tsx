// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DownloadButtonRow } from "@/components/download-button-row";
import type { DownloadStatus } from "@/hooks/use-media-downloader";

vi.mock("@/components/sound-manager", () => ({
  useSound: () => ({ play: vi.fn() }),
}));

const IDLE: DownloadStatus = { state: "idle", progress: 0, total: 0 };

type Props = Parameters<typeof DownloadButtonRow>[0];

function renderRow(overrides: Partial<Props> = {}) {
  const props: Props = {
    hasVideo: false,
    isImagePost: false,
    hasImages: false,
    hasMusic: false,
    isLivePhoto: false,
    isMixedLivePhoto: false,
    isLivePhotoPending: false,
    selectedCount: 0,
    totalImages: 0,
    musicPreviewSrc: null,
    musicMeta: null,
    video: IDLE,
    music: IDLE,
    images: IDLE,
    zip: IDLE,
    onDownloadVideo: vi.fn(),
    onDownloadMusic: vi.fn(),
    onDownloadImages: vi.fn(),
    onDownloadZip: vi.fn(),
    onOpenCompose: vi.fn(),
    onPreviewVideo: vi.fn(),
    onPreviewImages: vi.fn(),
    onCopyLink: vi.fn(),
    ...overrides,
  };
  return render(<DownloadButtonRow {...props} />);
}

afterEach(cleanup);

describe("DownloadButtonRow", () => {
  it("普通视频帖：显示预览/复制/下载视频，不显示图片类按钮", () => {
    renderRow({ hasVideo: true });
    expect(screen.getByText("预览视频")).toBeInTheDocument();
    expect(screen.getByText("复制链接")).toBeInTheDocument();
    expect(screen.getByText("下载视频")).toBeInTheDocument();
    expect(screen.queryByText(/下载选中/)).not.toBeInTheDocument();
    expect(screen.queryByText("打包下载")).not.toBeInTheDocument();
    expect(screen.queryByText("合成图文视频")).not.toBeInTheDocument();
  });

  it("普通图文帖：显示图片下载/打包/预览/合成，不显示视频下载", () => {
    renderRow({
      isImagePost: true,
      hasImages: true,
      totalImages: 3,
      selectedCount: 1,
    });
    expect(screen.getByText("下载选中 (1/3)")).toBeInTheDocument();
    expect(screen.getByText("打包下载")).toBeInTheDocument();
    expect(screen.getByText("预览图片")).toBeInTheDocument();
    expect(screen.getByText("合成图文视频")).toBeInTheDocument();
    expect(screen.queryByText("下载视频")).not.toBeInTheDocument();
    expect(screen.queryByText("预览视频")).not.toBeInTheDocument();
  });

  it("图片未选中时下载按钮禁用", () => {
    renderRow({ isImagePost: true, hasImages: true, totalImages: 2, selectedCount: 0 });
    const btn = screen.getByText(/下载选中/).closest("button")!;
    expect(btn).toBeDisabled();
  });

  it("图片下载中显示进度且禁用", () => {
    renderRow({
      isImagePost: true,
      hasImages: true,
      totalImages: 2,
      selectedCount: 1,
      images: { state: "downloading", progress: 1, total: 2 },
    });
    // 下载中按钮文案切换为进度 "1/2"，不再含"下载选中"
    const btn = screen.getByText("1/2").closest("button")!;
    expect(btn).toBeDisabled();
  });

  it("有音乐时展示歌曲信息与下载原声按钮", () => {
    renderRow({
      hasMusic: true,
      musicPreviewSrc: "https://example.com/m.m4a",
      musicMeta: { title: "测试歌", author: "歌手" },
    });
    expect(screen.getByText("测试歌")).toBeInTheDocument();
    expect(screen.getByText("下载原声音乐")).toBeInTheDocument();
  });

  it("音乐下载中显示百分比进度", () => {
    renderRow({
      hasMusic: true,
      musicPreviewSrc: "https://example.com/m.m4a",
      musicMeta: { title: "x", author: "y" },
      music: { state: "downloading", progress: 42, total: 0 },
    });
    expect(screen.getByText("下载中 42%")).toBeInTheDocument();
  });

  it("点击复制链接触发 onCopyLink", () => {
    const onCopyLink = vi.fn();
    renderRow({ onCopyLink });
    fireEvent.click(screen.getByText("复制链接"));
    expect(onCopyLink).toHaveBeenCalledTimes(1);
  });

  it("单图实况隐藏图片下载按钮、显示预览原图", () => {
    renderRow({
      isImagePost: true,
      hasImages: true,
      isLivePhoto: true,
      totalImages: 1,
    });
    expect(screen.queryByText(/下载选中/)).not.toBeInTheDocument();
    expect(screen.getByText("预览原图")).toBeInTheDocument();
  });
});
