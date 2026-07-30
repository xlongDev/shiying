# 前端架构评审报告 · 抖音无水印解析器

> 评审对象：`/Users/xiaolong/Documents/Project/shiying`（Next.js 16 App Router 单页工具应用）
> 评审类型：静态架构体检 + 五维度量化评分
> 评审日期：2026-07-30
> 评审人：前端工程架构分析专家（静态分析）

---

## 一、项目信息头

| 项 | 值 |
|----|----|
| 主框架 | Next.js `^16.2.10`（App Router，standalone 输出） |
| UI 框架 | React `^19.2.7` + TypeScript `^6.0.3` |
| 样式 | Tailwind CSS `^4.3.2`（CSS-first，postcss `@tailwindcss/postcss`） |
| 状态 | 本地 `useState` + `localStorage`（zustand/react-query 已装未用） |
| 核心能力库 | `@ffmpeg/*`（客户端合成）、`puppeteer-core`+`chrome-finder`（实况解析）、`jszip`、`sharp` |
| 数据层 | Prisma `^7.8.0`（已配置 `db.ts`，但 **0 处业务引用**） |
| 代码规模 | `src/` 89 文件 / 14,745 行（69 tsx + 19 ts + 1 css） |
| 测试 | **无**（0 测试框架、0 测试目录） |
| CI/CD | **无**（无 GitHub Actions / Vercel / 任何流水线） |
| 包管理器 | **三锁共存**：`bun.lock` + `package-lock.json` + `pnpm-lock.yaml` |

---

## 二、总览评分表

| 维度 | 得分 | 满分 | 百分比 | 星级 |
|------|------|------|--------|------|
| 技术栈健康度 | 32 | 50 | 64% | ⭐⭐⭐ |
| 架构设计模式 | 30 | 50 | 60% | ⭐⭐⭐ |
| 工程化成熟度 | 16 | 50 | 32% | ⭐ |
| 性能与可维护性 | 27 | 50 | 54% | ⭐⭐ |
| **综合评分** | **54** | **100** | **54%** | **⭐⭐** |

**诊断结论**：核心功能架构思路清晰（两阶段解析、类型定义详尽、Tailwind v4 配置规范），但 **工程化质量门禁几乎全失守**——类型检查被 `ignoreBuildErrors` 关闭、ESLint 规则近乎全关、无测试、无 CI、包管理器三套混用、十余个顶级依赖与 35 个 UI 组件为死代码。综合处于「及格偏下」区间，技术债主要集中在「工程纪律」而非「业务设计」。

---

## 三、维度详解

### 维度 1 · 技术栈健康度 — 32/50 ⭐⭐⭐

**做得好的（加分项）**
- 框架版本前沿且选型合理：Next 16 + React 19 + TS 6，App Router 模式利用到位。
- **Tailwind v4 配置正确**：`globals.css` 采用 CSS-first（`@import "tailwindcss"` + `@theme inline`），自定义 `keyframes`/`animate-*` **直接写在 CSS 而非 `tailwind.config.ts`**，精准避开了 v4 的经典坑（v4 忽略 config 中的 keyframes）——这是很多团队踩过的雷，本项目处理正确。
- 依赖功能库定位清晰：`ffmpeg` / `puppeteer-core` / `jszip` / `sharp` 与业务强相关。

**严重问题（扣分项）**
- **死依赖泛滥（约 14 个顶级库 0 业务引用）**：`next-auth`、`next-intl`、`zustand`、`@tanstack/react-query`、`@mdxeditor/editor`、`@dnd-kit/*`、`react-syntax-highlighter`、`react-markdown`、`z-ai-web-dev-sdk`、`@tanstack/react-table` 全部 0 引用；`recharts`/`react-day-picker`/`vaul`/`cmdk`/`embla-carousel-react` 仅被**未被业务引用的** `ui` 组件牵连。
- **Prisma 是空架子**：`src/lib/db.ts` 单例化了 `PrismaClient`，但**没有任何 API 路由 `import` 它**，schema 也未接入任何读写 —— 整条数据层 + `prisma` 依赖是死重。
- **TS 配置放水**：`tsconfig.json` 中 `strict: true` 但显式 `noImplicitAny: false`，`eslint` 又关闭 `no-explicit-any` —— 隐式/显式 `any` 可自由渗透，strict 名存实亡。
- **包管理器三锁共存**：`bun.lock` / `package-lock.json` / `pnpm-lock.yaml` 同时存在，且 `package.json` scripts 里 `start` 用 `bun` 跑、`dev`/`build` 用 `next` —— 依赖树来源不一致，CI 与本地极易装出不同结果。

---

### 维度 2 · 架构设计模式 — 30/50 ⭐⭐⭐

**做得好的（加分项）**
- 目录结构清晰：`app/` + `components/` + `lib/` + `hooks/`，按功能而非按类型组织，符合 App Router 最佳实践。
- **类型定义质量高**：`parser.ts` 中 `ParsedVideo` / `LivePhotoInfo` 接口字段注释详尽、语义清晰（如 `livePhotoPending` vs `livePhotoBackground` 的差异说明），是项目里最稳健的资产。
- **两阶段解析设计合理**：`/api/parse?skipLivePhoto=true` 快首屏 + `/api/parse-live-photo` 异步补全实况，思路正确，兼顾首屏速度。
- API 路由按职责清晰分离（parse / parse-live-photo / live-compose / download-music / extract-audio / proxy / stream）。
- 已做组件解耦尝试（`LivePhotoPanel` 从 `VideoResult` 拆出）。

**严重问题（扣分项）**
- **上帝组件**：`live-photo-panel.tsx` **989 行**、`video-result.tsx` **965 行**、`compose-video-modal.tsx` **622 行**。单文件既管 UI 又管下载逻辑、合成逻辑、多组 `useState`（`live-photo-panel` 内 6+ 个下载状态），单一职责原则被突破，可维护性差。
- **业务逻辑与 UI 强耦合**：`page.tsx`（324 行，`"use client"`）把 `handleParse` / `resolveLivePhotos` 等核心业务流程、历史记录 `localStorage` 直写全部塞在主页面组件里，无法复用、无法单测。
- **无统一状态/数据层**：已装 `zustand` 与 `react-query` 却用原生 `useState` + `localStorage`，能力浪费。
- `localStorage` 存完整 `ParsedVideo`（含 `raw` 大对象），多存几条即逼近 5MB 上限，存在静默写入失败风险。

---

### 维度 3 · 工程化成熟度 — 16/50 ⭐

**这是最薄弱、最需优先抢救的维度。**

**做得好的（加分项）**
- `output: "standalone"` + build 脚本 `cp static/public` 到 standalone，部署形态（独立 `server.js`）思路清晰。
- 提供 `db:push` / `db:generate` / `db:migrate` 等完整 Prisma 脚本（可惜数据层未被使用）。

**致命缺口（扣分项）**
- **类型门禁关闭**：`next.config.ts` `typescript.ignoreBuildErrors: true` —— 类型错误不再阻断构建，TS 的编译期保障被主动放弃。
- **ESLint 形同虚设**：`eslint.config.mjs` 关闭了 `no-unused-vars`、`prefer-const`、`no-console`、`no-debugger`、`no-undef`、`no-redeclare`、`react-hooks/exhaustive-deps` 等几乎所有有约束力的规则 —— 等于没有代码质量门禁。
- **0 测试**：无 `vitest`/`jest`/`playwright`，无 `__tests__` 目录。纯函数 `parser.ts`（最易测、最该测）也裸奔。
- **无 CI/CD**：无任何流水线配置，合并即上、靠人工。
- **无 Prettier / Husky / lint-staged**：格式化与提交钩子缺失。
- **包管理器混乱**（见维度 1）。

> 一句话：质量门禁（类型 / lint / 测试 / CI）四扇门全开，工程纪律在这项目里基本靠自觉。

---

### 维度 4 · 性能与可维护性 — 27/50 ⭐⭐

**做得好的（加分项）**
- 两阶段加载让首屏不被实况解析阻塞，体验取舍合理。
- `globals.css` 动效克制：极光/玻璃用 `transform`/`opacity`，且 `@media (prefers-reduced-motion: reduce)` 全局降级 —— 无障碍适配到位。
- `useReducedMotion` 在前端组件内正确使用，避免无障碍场景下的误动画。
- App Router 下未使用的 `ui` 组件可被 tree-shaking 排除，bundle 运行时污染有限（但 `node_modules` 安装体积仍被死依赖撑大）。

**风险项（扣分项）**
- **ffmpeg.wasm 客户端合成**：`ffmpeg-compose.ts` 759 行，客户端加载 wasm 做图文/实况合成，CPU 与内存开销大，低端设备易卡顿，且无进度/降级兜底在报告中未体现（需确认）。
- **可维护性风险高**：上帝组件 + 无测试 + 无类型门禁 → 任何改动都无回归保护，重构即赌博。
- 媒体代理 `proxy-media` / `stream` 若无缓存与超时控制，可能成为服务端资源泄漏点（需结合路由实现确认）。

---

### 维度 5 · 综合评分 — 54/100 ⭐⭐

加权映射自前四项（技术栈 64% + 架构 60% + 工程化 32% + 性能 54%，综合 54%）。
定位：**及格偏下**。项目「能跑、功能完整、UI 精致」，但工程纪律缺失使其长期维护成本与线上风险不成比例地高。好消息是：所有硬伤都是**配置层与依赖层**问题，不涉及业务内核重写，整改 ROI 极高。

---

## 四、架构亮点（客观肯定）

1. **Tailwind v4 落地规范**：CSS-first + keyframes 正确位置，避开了 v4 迁移最常见的动画失效坑。
2. **类型契约扎实**：`ParsedVideo` / `LivePhotoInfo` 注释详尽，是后续重构的可靠锚点。
3. **两阶段解析架构**：快首屏 + 慢补全，工程取舍合理，是本项目最有价值的架构决策。
4. **组件解耦意识**：已主动将 `LivePhotoPanel` 从 `VideoResult` 剥离，说明作者有重构自觉。
5. **无障碍适配**：reduced-motion 全局降级，超出一般个人项目的完成度。

---

## 五、重构优先级表

> 估算工时基于单人熟练前端经验，不含联调与回归验证。

### P0 · 立即整改（质量门禁失守，阻塞所有后续工作）

| # | 项 | 具体动作 | 预期收益 | 工时 |
|---|----|---------|---------|------|
| P0-1 | 恢复类型门禁 | `next.config.ts` 删除 `ignoreBuildErrors: true`；`tsconfig.json` 恢复 `noImplicitAny: true`；跑 `tsc --noEmit` 修复暴露的 any | 让 strict 真正生效，捕获回归 | 2h |
| P0-2 | 重建 ESLint 门禁 | 恢复 `no-unused-vars`/`prefer-const`/`exhaustive-deps(warn)` 等核心规则，移除「全关」配置 | 杜绝明显坏代码合入 | 3h |
| P0-3 | 统一包管理器 | 删除 `bun.lock` + `package-lock.json`，仅保留 `pnpm-lock.yaml`；`start` 脚本改用 `pnpm`/`node` 而非 `bun` | 依赖树一致，告别「我本地能跑」 | 2h |

### P1 · 本迭代（债务清理 + 可维护性）

| # | 项 | 具体动作 | 预期收益 | 工时 |
|---|----|---------|---------|------|
| P1-1 | 清理死依赖 | 移除 `next-auth`/`next-intl`/`zustand`/`react-query`/`mdxeditor`/`@dnd-kit/*`/`react-syntax-highlighter`/`react-markdown`/`z-ai-web-dev-sdk`/`@tanstack/react-table`/`prisma`+`@prisma/client`（含 `prisma/schema`）及未被引用的 35 个 `ui` 组件 | 安装体积 ↓、安全面 ↓、升级成本 ↓ | 4h |
| P1-2 | 拆分上帝组件 | `video-result`/`live-photo-panel` 抽取下载逻辑为 `hooks/use-downloader`、合成逻辑为独立模块；`page.tsx` 业务流程下沉到 hook | 单一职责、可复用、可测 | 8h |
| P1-3 | 接入状态/数据层 | 启用已装的 `zustand`（历史/解析状态）或 `react-query`（API 缓存），替代 `useState`+`localStorage` 直写 | 状态可预测、避免 localStorage 爆仓 | 4h |
| P1-4 | 补齐基础测试 | 对纯函数 `parser.ts` 加 `vitest` 单测；加 1 条 Playwright 主流程 smoke | 关键逻辑有回归保护 | 6h |

### P2 · 下一迭代（工程化闭环）

| # | 项 | 具体动作 | 预期收益 | 工时 |
|---|----|---------|---------|------|
| P2-1 | 接入 CI/CD | GitHub Actions：lint → typecheck → test → build | 合并即验，阻断坏代码 | 3h |
| P2-2 | localStorage 治理 | 不存 `raw` 大对象、限历史条数；或真正用 Prisma 持久化（若需） | 规避 5MB 静默失败 | 3h |
| P2-3 | 开启 StrictMode | `reactStrictMode: true` 并修复副作用双调用 | 提前暴露内存/副作用问题 | 0.5h |
| P2-4 | 规范化工具链 | 加 Prettier + Husky + lint-staged | 提交即格式化、门禁前置 | 2h |

---

## 六、免责声明

本报告基于静态分析（配置文件、源码结构、依赖引用图谱）与经验规则生成，未运行项目、未做运行时 profiling 与真实流量压测。部分结论（如 ffmpeg.wasm 客户端性能、媒体代理资源泄漏）需结合运行日志进一步确认。评分反映「工程成熟度」相对行业最佳实践的位置，不构成唯一正确决策。**架构没有银弹，合适的才是最好的**——对于个人工具类应用，P0 项（门禁与包管理）建议必做，P1/P2 可按实际维护诉求取舍。

---

*本报告由前端工程架构分析专家生成，仅供参考，实际重构决策请结合团队情况综合判断。*
