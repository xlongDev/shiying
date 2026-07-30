import "@testing-library/jest-dom/vitest";

/**
 * jsdom 缺失的浏览器 API 兜底。
 * 仅当运行在 DOM 环境（组件测试）时注入；node 环境的 parser 测试不受影响。
 */
if (typeof window !== "undefined") {
  // framer-motion 的 useReducedMotion 依赖 matchMedia
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }

  // framer-motion 的 layout 动画依赖 ResizeObserver（jsdom 未实现，直接兜底）
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver =
    ResizeObserverStub as unknown as typeof globalThis.ResizeObserver;

  // jsdom 未实现 HTMLMediaElement.play/pause —— 组件调用 play().catch() 会抛错
  const mediaProto = window.HTMLMediaElement.prototype;
  mediaProto.play = (() => Promise.resolve()) as typeof mediaProto.play;
  mediaProto.pause = (() => {}) as typeof mediaProto.pause;

  // jsdom 的 rAF 行为不稳定，置为 no-op 以规避进度循环 / 动画回调噪声
  window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
}
