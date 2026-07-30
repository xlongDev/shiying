// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GlassVideoControls } from "@/components/glass-video-controls";

const SRC = "https://example.com/video.mp4";

afterEach(cleanup);

describe("GlassVideoControls", () => {
  it("渲染 <video> 与首屏播放按钮", () => {
    const { container } = render(<GlassVideoControls src={SRC} />);
    expect(container.querySelector("video")).toBeInTheDocument();
    // 未播放时显示覆盖层大播放按钮 + 控制条播放按钮，均为「播放」
    expect(screen.getAllByLabelText("播放").length).toBeGreaterThanOrEqual(1);
  });

  it("点击播放 → 调用 video.play()，并在 play 事件后切换为暂停态", () => {
    render(<GlassVideoControls src={SRC} />);
    const video = document.querySelector("video") as HTMLVideoElement;
    const playSpy = vi.spyOn(video, "play").mockResolvedValue(undefined);

    // 首屏同时存在「覆盖层大播放按钮」与「控制条播放按钮」，均为 aria-label="播放"
    fireEvent.click(screen.getAllByLabelText("播放")[0]);
    expect(playSpy).toHaveBeenCalledTimes(1);

    // 组件通过 <video> 的 onPlay 事件驱动 playing 状态
    fireEvent.play(video);
    expect(screen.getByLabelText("暂停")).toBeInTheDocument();
  });

  it("静音按钮默认 muted → 初始为「取消静音」，点击后切换", () => {
    render(<GlassVideoControls src={SRC} />);
    const video = document.querySelector("video") as HTMLVideoElement;
    expect(screen.getByLabelText("取消静音")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("取消静音"));
    expect(video.muted).toBe(false);
    expect(screen.getByLabelText("静音")).toBeInTheDocument();
  });

  it("打开更多菜单展示倍速选项，选择后关闭菜单", () => {
    render(<GlassVideoControls src={SRC} />);
    fireEvent.click(screen.getByLabelText("更多选项"));
    // 菜单经 Portal 渲染到 document.body，screen 仍可查到
    expect(screen.getByText("0.5x")).toBeInTheDocument();
    expect(screen.getByText("全屏预览")).toBeInTheDocument();

    fireEvent.click(screen.getByText("0.5x"));
    expect(screen.queryByText("0.5x")).not.toBeInTheDocument();
  });
});
