import { describe, it, expect, vi } from "vitest";
import { navigateNotePage } from "./navigate";
import type { Page } from "puppeteer-core";

function mockPage(overrides: Partial<Page> = {}): Page {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Page;
}

describe("navigateNotePage", () => {
  it("导航成功且 hydration 就绪返回 true", async () => {
    const page = mockPage();
    const ok = await navigateNotePage(page, "/share/note/123", Date.now());
    expect(ok).toBe(true);
    expect(page.goto).toHaveBeenCalledWith(
      "https://www.douyin.com/share/note/123",
      expect.objectContaining({ waitUntil: "domcontentloaded", timeout: 12000 })
    );
  });

  it("goto 抛错时返回 false（视为无实况兜底）", async () => {
    const page = mockPage({
      goto: vi.fn().mockRejectedValue(new Error("net::ERR_TIMED_OUT")),
    });
    const ok = await navigateNotePage(page, "/share/note/1", Date.now());
    expect(ok).toBe(false);
  });

  it("waitForFunction 超时（被 catch 吞掉）仍返回 true", async () => {
    const page = mockPage({
      waitForFunction: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    const ok = await navigateNotePage(page, "/share/note/9", Date.now());
    expect(ok).toBe(true);
  });
});
