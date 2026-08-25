// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { UrlInput } from "@/components/url-input";

// 隔离真实 toast 副作用，仅断言调用行为
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const { toast } = await import("sonner");

beforeEach(() => {
  // 让自动读剪贴板逻辑安全且无副作用（mock 返回空文本）
  Object.assign(navigator, {
    clipboard: { readText: vi.fn().mockResolvedValue("") },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UrlInput", () => {
  it("渲染输入框、粘贴按钮与解析按钮", () => {
    render(<UrlInput onParse={() => {}} loading={false} />);
    expect(screen.getByPlaceholderText("粘贴抖音分享链接或文本...")).toBeInTheDocument();
    expect(screen.getByLabelText("粘贴链接")).toBeInTheDocument();
    expect(screen.getByText("开始解析")).toBeInTheDocument();
  });

  it("输入链接后点击「开始解析」回调 onParse（带 trim）", () => {
    const onParse = vi.fn();
    render(<UrlInput onParse={onParse} loading={false} />);

    const input = screen.getByPlaceholderText("粘贴抖音分享链接或文本...");
    fireEvent.change(input, { target: { value: "  https://v.douyin.com/abc  " } });
    fireEvent.click(screen.getByText("开始解析"));

    expect(onParse).toHaveBeenCalledTimes(1);
    expect(onParse).toHaveBeenCalledWith("https://v.douyin.com/abc");
  });

  it("输入框为空时解析按钮禁用", () => {
    render(<UrlInput onParse={() => {}} loading={false} />);
    const btn = screen.getByRole("button", { name: "开始解析" });
    expect(btn).toBeDisabled();
  });

  it("空提交时提示错误且不调用 onParse", () => {
    const onParse = vi.fn();
    render(<UrlInput onParse={onParse} loading={false} />);

    const form = screen
      .getByPlaceholderText("粘贴抖音分享链接或文本...")
      .closest("form") as HTMLFormElement;
    fireEvent.submit(form);

    expect(onParse).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("请输入抖音链接");
  });

  it("点击清空按钮清空输入框", () => {
    render(<UrlInput onParse={() => {}} loading={false} />);
    const input = screen.getByPlaceholderText("粘贴抖音分享链接或文本...") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "https://v.douyin.com/xyz" } });
    expect(input.value).toBe("https://v.douyin.com/xyz");

    fireEvent.click(screen.getByLabelText("清空"));
    expect(input.value).toBe("");
  });

  it("externalUrl 带分享文本时提取纯 URL 回填输入框", () => {
    render(
      <UrlInput
        onParse={() => {}}
        loading={false}
        externalUrl="快看这个 https://v.douyin.com/def 啊"
      />
    );
    const input = screen.getByPlaceholderText("粘贴抖音分享链接或文本...") as HTMLInputElement;
    expect(input.value).toBe("https://v.douyin.com/def");
  });
});
