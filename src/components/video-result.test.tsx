// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { VideoResult } from "@/components/video-result";
import type { ParsedVideo } from "@/lib/parser";

// 重组件 / 副作用组件打桩，聚焦 VideoResult 自身的编排与数据透传
vi.mock("@/components/sound-manager", () => ({
  useSound: () => ({ play: vi.fn() }),
}));
vi.mock("@/components/live-photo-panel", () => ({
  LivePhotoPanel: () => <div data-testid="live-photo-panel" />,
}));
vi.mock("@/components/image-selection-grid", () => ({
  ImageSelectionGrid: () => <div data-testid="image-selection-grid" />,
}));
vi.mock("@/components/compose-video-modal", () => ({
  ComposeVideoModal: () => null,
}));

afterEach(cleanup);

const videoPost: ParsedVideo = {
  platform: "douyin",
  awemeId: "v1",
  desc: "一条测试视频",
  author: { name: "视频作者", avatar: "https://example.com/a.jpg" },
  cover: "https://example.com/c.jpg",
  videoUrl: "https://example.com/v.mp4",
  hasMusic: false,
  stats: { likeCount: 1200, commentCount: 30, shareCount: 5 },
  contentType: "video",
};

const imagePost: ParsedVideo = {
  platform: "douyin",
  awemeId: "n1",
  desc: "一组测试图文",
  author: { name: "图作者", avatar: "https://example.com/a.jpg" },
  cover: "https://example.com/c.jpg",
  videoUrl: "",
  isImagePost: true,
  images: ["https://example.com/i1.jpg", "https://example.com/i2.jpg"],
  hasMusic: true,
  musicMeta: { title: "背景歌", author: "歌手" },
  contentType: "note",
};

describe("VideoResult", () => {
  it("普通视频帖：渲染作者/描述与视频下载区，不渲染图片网格", () => {
    render(<VideoResult video={videoPost} />);
    expect(screen.getByText("视频作者")).toBeInTheDocument();
    expect(screen.getByText("一条测试视频")).toBeInTheDocument();
    expect(screen.getByText("下载视频")).toBeInTheDocument();
    expect(screen.getByText("复制链接")).toBeInTheDocument();
    expect(screen.queryByTestId("image-selection-grid")).not.toBeInTheDocument();
  });

  it("图文帖：渲染图片选择网格/合成入口/音乐信息，不渲染视频下载", () => {
    render(<VideoResult video={imagePost} />);
    expect(screen.getByTestId("image-selection-grid")).toBeInTheDocument();
    expect(screen.getByText("合成图文视频")).toBeInTheDocument();
    expect(screen.getByText("背景歌")).toBeInTheDocument();
    expect(screen.queryByText("下载视频")).not.toBeInTheDocument();
  });

  it("实况照片面板始终挂载", () => {
    const { rerender } = render(<VideoResult video={videoPost} />);
    expect(screen.getByTestId("live-photo-panel")).toBeInTheDocument();
    rerender(<VideoResult video={imagePost} />);
    expect(screen.getByTestId("live-photo-panel")).toBeInTheDocument();
  });
});
