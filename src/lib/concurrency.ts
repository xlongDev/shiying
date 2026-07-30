/**
 * 极简的内存信号量（无第三方依赖），用于限制并发的 ffmpeg 子进程数量。
 */

export interface Semaphore {
  /** 获取一个许可，若无可用许可则排队等待。 */
  acquire(): Promise<void>;
  /** 释放一个许可，唤醒队首等待者。 */
  release(): void;
}

/**
 * 创建一个最大并发数为 max 的异步信号量。
 * 基于 FIFO 队列实现，避免惊群与饥饿。
 */
export function createSemaphore(max: number): Semaphore {
  let active = 0;
  const queue: Array<() => void> = [];

  return {
    async acquire(): Promise<void> {
      if (active < max) {
        active++;
        return;
      }
      await new Promise<void>((resolve) => queue.push(resolve));
    },
    release(): void {
      if (active > 0) active--;
      const next = queue.shift();
      if (next) {
        active++;
        next();
      }
    },
  };
}

/** 服务端 ffmpeg 子进程并发上限：同时最多 2 个。 */
export const ffmpegSemaphore = createSemaphore(2);
