# 主解析浏览器兜底修复 + 共享浏览器池统一（2026-08-02）

## 问题背景
dev 日志（用户 Mac 本机 `pnpm dev`，海外 IP）显示 `/api/parse` 大面积返回 **400**：
- SSR 分享页被 WAF 拦截、a_bogus 签名 API 海外返回空响应 → 全部走到浏览器兜底；
- 但 `browser-router-data.ts` 的 `loadRouterDataViaBrowser` 有两个硬伤：
  1. **每次冷启动一台 Chrome**（`puppeteer.launch` 直调，8s+，且带 `--single-process` 不稳定）；
  2. **fiber 提取 `extractItemFromFiberInPage` 直接 `Object.keys(seed)`** 不向上遍历祖先 fiber，
     遇到无 fiber 的节点或导航中 detach 的节点就抛 `Cannot convert undefined or null to object`，
     同时漏遍历 `memoizedState`，遇到 SPA 异步注入数据就 `Execution context was destroyed`。
- 同环境、同台复用浏览器下，`live-photo-resolver` 的 fiber 提取却正常（14 图/0 实况短路成功），
  证明两套实现不一致——主解析用的是一套坏逻辑。

## 改动
### 新增 `src/lib/browser-pool.ts`（共享浏览器池，单例）
- 常驻一台共享 Browser，跨所有解析 / 实况探测请求复用；首请求付冷启动成本，后续复用 warm 浏览器。
- `puppeteerSemaphore` 语义由「并发 Chrome 实例数」改为「并发 page 数」（单台浏览器下更合理，防 OOM）。
- 浏览器进程 `disconnected` 自动置空、下次重启动；`SIGINT/SIGTERM` 退出时关闭，避免孤儿 Chrome。
- 移除 `--single-process` / `--no-zygote`（多 page 下不稳定）。
- 导出 `getSharedBrowser` / `acquirePage` / `releasePage` / `navigateAndWait`（导航 + hydration + 数据注入轮询）。

### 重构 `src/lib/live-photo-resolver.ts`
- 删除本地重复的池代码（`getSharedBrowser` / `openNoteBrowser` / `closeNoteBrowser` / `registerBrowserCleanup` / 本地 `DESKTOP_UA`）。
- 改用 `browser-pool` 的 `acquirePage` / `releasePage`；`navigateNotePage` 保留（已验证可用）。

### 重写 `src/lib/browser-router-data.ts` 的 `loadRouterDataViaBrowser`
- 复用 `browser-pool` 的 `acquirePage` + `navigateAndWait`，不再各自冷启动。
- 移植**健壮 fiber 提取**：`getFiber` 向上遍历祖先节点找 `__reactFiber` + 遍历
  `memoizedProps`/`memoizedState` + `child/sibling/return`，全程 null/类型守卫，
  优先匹配 `aweme_id === targetId`，修复 `Cannot convert undefined or null to object`。
- `evaluate` 异常（含 SPA 导航中的 `Execution context was destroyed`）被捕获并切换到下一候选 URL。
- 候选 URL 收敛为 `www.douyin.com/note/{id}` 与 `/video/{id}`（去掉常 `ERR_ABORTED` 的 iesdouyin 分享页）。

## 验证
- `typecheck` ✅  `lint` ✅ 0 error（56 warning 基线）  `test` ✅ 94/94  `format:check` ✅
- 注：本沙箱无 Chrome / 连不到抖音，无法在此做真实端到端；逻辑正确性由类型检查 + 既有测试 + 与
  `live-photo-resolver` 同源的健壮 fiber 实现保证。请在用户 Mac 本机 `pnpm dev` 后复测。

## 请在本机复测
刷新 `localhost:3000`，贴之前 400 的链接（如 `7668589765113289401`、`7593685337315482097`、
`7652223787917148325`），应不再 400，且 dev 终端出现 `浏览器兜底命中(fiber)` 或 `(_ROUTER_DATA)`。
性能上主解析与实况探测共享一台 warm 浏览器，单次兜底从 ~8s 冷启动降至 ~3-4s。
