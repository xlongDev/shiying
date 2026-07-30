/* eslint-disable no-console -- 本模块是 console 的统一封装层 */
/**
 * 轻量分级日志器（零第三方依赖）。
 *
 * 设计目标：
 * - 统一服务端散落的 console.warn / console.error，便于生产环境可观测性。
 * - 支持按 LOG_LEVEL 环境变量过滤（debug < info < warn < error，默认 info）。
 * - 输出带 ISO 时间戳 + 模块 scope 前缀，方便日志采集与告警规则匹配。
 *
 * 用法：
 *   import { logger } from "@/lib/logger";
 *   logger.warn("slides", "SSR JSON 解析失败:", err);
 *   logger.error("parse", "unexpected error:", err);
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function getThreshold(): number {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return LEVEL_ORDER[raw as LogLevel] ?? LEVEL_ORDER.info;
}

function emit(level: LogLevel, scope: string, args: unknown[]): void {
  if (LEVEL_ORDER[level] < getThreshold()) return;
  const ts = new Date().toISOString();
  const prefix = `${ts} [${level.toUpperCase()}] [${scope}]`;
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(prefix, ...args);
}

export const logger = {
  debug: (scope: string, ...args: unknown[]): void => emit("debug", scope, args),
  info: (scope: string, ...args: unknown[]): void => emit("info", scope, args),
  warn: (scope: string, ...args: unknown[]): void => emit("warn", scope, args),
  error: (scope: string, ...args: unknown[]): void => emit("error", scope, args),
};
