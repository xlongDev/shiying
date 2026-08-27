/**
 * a_bogus 签名 API 熔断器。
 *
 * 背景：在海外 IP / 算法版本过期 / 缺有效 msToken 等情况下，a_bogus 路径会稳定失败。
 * 每次请求都真实打两次上游（真实 cookie + 合成 ttwid）会浪费 ~0.8s，且必然失败。
 * 引入轻量熔断：连续失败达到阈值后暂停尝试一段时间（冷却），冷却结束后必重试一次，
 * 既避免无谓耗时，又保证"环境恢复后能自动重新启用"——不会永久禁用，对纯 a_bogus
 * 部署机（无 Chrome）依然友好。
 *
 * 状态挂到 globalThis：Next.js 的 instrumentation 与路由 handler 可能为不同模块实例，
 * 若仅用模块级 let，熔断计数跨实例不共享，失去意义。
 */
interface CircuitState {
  failures: number;
  blockedUntil: number; // epoch ms，0 表示未熔断
}

const g = globalThis as unknown as { __shiyingAbogusCircuit?: CircuitState };
const state: CircuitState =
  g.__shiyingAbogusCircuit ?? (g.__shiyingAbogusCircuit = { failures: 0, blockedUntil: 0 });

const THRESHOLD = 3;
const COOLDOWN_MS = 120_000; // 2 分钟：冷却结束后必重试一次

/** 熔断中（连续失败达到阈值且冷却未过）返回 true，调用方应跳过 a_bogus 尝试 */
export function abogusShouldSkip(): boolean {
  return state.blockedUntil > 0 && Date.now() < state.blockedUntil;
}

/** a_bogus 命中：重置熔断计数，恢复正常尝试 */
export function abogusRecordSuccess(): void {
  state.failures = 0;
  state.blockedUntil = 0;
}

/** a_bogus 失败：累加计数，达阈值则开启熔断（冷却 COOLDOWN_MS） */
export function abogusRecordFailure(): void {
  state.failures += 1;
  if (state.failures >= THRESHOLD) {
    state.blockedUntil = Date.now() + COOLDOWN_MS;
  }
}

/** 强制重置熔断（诊断路由开工前调用，确保本次探测不被既有熔断拦截） */
export function abogusReset(): void {
  state.failures = 0;
  state.blockedUntil = 0;
}

/** 供日志/诊断读取当前熔断状态 */
export function abogusCircuitStatus(): { failures: number; blockedUntil: number } {
  return { failures: state.failures, blockedUntil: state.blockedUntil };
}
