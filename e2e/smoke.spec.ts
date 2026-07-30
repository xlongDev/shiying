import { test, expect } from "@playwright/test";

/**
 * 首页冒烟测试：验证页面能正常加载、核心 UI（标题 + URL 输入框）渲染。
 * 这是 P1-4 的 Playwright smoke 基线，后续可补充真实解析流程的 e2e。
 */
test("首页加载并渲染标题与 URL 输入框", async ({ page }) => {
  await page.goto("/");

  // Hero 标题含「抖音」
  await expect(page.getByText("抖音", { exact: false }).first()).toBeVisible();

  // URL 输入框占位符
  const input = page.getByPlaceholder("粘贴抖音分享链接或文本...");
  await expect(input).toBeVisible();
});

test("空链接解析应给出校验提示而非崩溃", async ({ page }) => {
  await page.goto("/");
  const input = page.getByPlaceholder("粘贴抖音分享链接或文本...");
  await input.fill("   ");
  await input.press("Enter");
  // 至少页面不白屏：标题仍在
  await expect(page.getByText("抖音", { exact: false }).first()).toBeVisible();
});
