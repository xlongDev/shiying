// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GlassAudioControls } from "@/components/glass-audio-controls";

const SRC = "https://example.com/audio.mp3";

afterEach(cleanup);

describe("GlassAudioControls", () => {
  it("渲染 <audio>、背景音乐标签与播放按钮", () => {
    const { container } = render(<GlassAudioControls src={SRC} />);
    expect(container.querySelector("audio")).toBeInTheDocument();
    expect(screen.getByText("背景音乐")).toBeInTheDocument();
    // 默认未静音 → aria-label 为「静音」
    expect(screen.getByLabelText("静音")).toBeInTheDocument();
  });

  it("showLabel=false 时不渲染背景音乐标签", () => {
    render(<GlassAudioControls src={SRC} showLabel={false} />);
    expect(screen.queryByText("背景音乐")).not.toBeInTheDocument();
  });

  it("点击播放 → 调用 audio.play()，并在 play 事件后切换为暂停态", () => {
    render(<GlassAudioControls src={SRC} />);
    const audio = document.querySelector("audio") as HTMLAudioElement;
    const playSpy = vi.spyOn(audio, "play").mockResolvedValue(undefined);

    fireEvent.click(screen.getByLabelText("播放"));
    expect(playSpy).toHaveBeenCalledTimes(1);

    fireEvent.play(audio);
    expect(screen.getByLabelText("暂停")).toBeInTheDocument();
  });

  it("静音按钮初始为「静音」，点击后切换为「取消静音」", () => {
    render(<GlassAudioControls src={SRC} />);
    const audio = document.querySelector("audio") as HTMLAudioElement;
    fireEvent.click(screen.getByLabelText("静音"));
    expect(audio.muted).toBe(true);
    expect(screen.getByLabelText("取消静音")).toBeInTheDocument();
  });

  it("打开更多菜单展示倍速与下载，选择倍速后关闭菜单", () => {
    render(<GlassAudioControls src={SRC} />);
    fireEvent.click(screen.getByLabelText("更多选项"));
    expect(screen.getByText("0.5x")).toBeInTheDocument();
    expect(screen.getByText("循环播放")).toBeInTheDocument();
    expect(screen.getByText("下载音乐")).toBeInTheDocument();

    fireEvent.click(screen.getByText("0.5x"));
    expect(screen.queryByText("0.5x")).not.toBeInTheDocument();
  });
});
