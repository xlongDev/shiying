# 依赖全量升级至最新版 — 执行报告

**项目**：抖音无水印解析器（Next.js 16 App Router + React 19 + TypeScript）
**日期**：2026-07-11
**操作**：`pnpm up -L`（全量依赖升到 latest，含 TypeScript 7）

## 一、升级结果（package.json / pnpm-lock.yaml 已更新）

| 依赖 | 旧 → 新 | 性质 |
|---|---|---|
| **typescript** | 5.9.3 → **7.0.2** | 本次重点（7 今日发正式版） |
| prisma / @prisma/client | 6.x → **7.8.0** | 主版本破坏性变更 |
| @mdxeditor/editor | 3.x → **4.0.4** | 主版本 |
| lucide-react | 0.x → **1.24.0** | 主版本（移除品牌图标） |
| next | 16.2.10 | 次版本 |
| react / react-dom | 19.2.7 | 次版本 |
| eslint / eslint-config-next | 10.6.0 / 16.2.10 | 主/次 |
| tailwindcss | 4.3.2 | v4 |
| zod | 4.4.3 | 主版本 |
| recharts | 3.9.2 | v3 |
| react-day-picker | 10.0.1 | v10 |
| react-resizable-panels | 4.12.1 | v4 |

## 二、兼容性修复（src/ 已落地）

1. **Prisma 7 破坏性变更**：`prisma/schema.prisma` 的 datasource 不再允许 `url = env(...)`，已移除；随后 `prisma generate` 成功生成客户端（v7.8.0）。
2. **lucide-react v1**：品牌图标 `Github` 已被移除（商标原因）→ `footer.tsx` / `header.tsx` 改用 `Code2`。
3. **react-resizable-panels v4**：`PanelGroup`→`Group`、`PanelResizeHandle`→`Separator`（在 `ui/resizable.tsx`）。
4. **react-day-picker v10**：`classNames.table` 键已移除（`ui/calendar.tsx`）。
5. **recharts v3**：`ui/chart.tsx` 的 `ChartTooltipContent` / `ChartLegendContent` 原依赖 `ComponentProps<typeof Tooltip>`（v3 已拆分类型），改为自包含类型，解耦脆弱的 recharts 类型。

> 注：`ui/chart`、`ui/calendar`、`ui/resizable` 当前均**未被业务代码 import**（shadcn 模板残留），仅影响 `tsc` 静态检查；上述修复保证类型零报错。

## 三、校验结果

| 校验项 | 结果 |
|---|---|
| `tsc --noEmit`（类型检查） | ✅ **0 错误** |
| `next build`（生产构建） | ✅ **通过**（编译 4.0s，5 个静态页全部生成） |
| `eslint .` | ⚠️ **暂被上游阻塞**（见下） |

## 四、已知限制（非阻塞，需知会）

**`eslint` 当前无法运行**：最新 `@typescript-eslint/*` 仍是 **8.63.0**，尚未支持今天发布的 TypeScript 7。`typescript-estree` 在读取 TS7 已移除的内部 API（`Cjs`）时崩溃。
- 这**不是代码可修复的问题**，需等待 `@typescript-eslint` 发布 TS7 兼容版。
- 在它到来之前，**类型安全以 `tsc --noEmit` 为准**（已 0 错误），`next build` 也已通过，项目的"构建 + 类型检查"实质达标。
- 恢复办法：待 typescript-eslint 发版后，执行 `pnpm up -L` 或单独 `pnpm add -D @typescript-eslint/parser @typescript-eslint/eslint-plugin@latest`。

## 五、其他说明

- **pnpm-workspace.yaml**：原 `allowBuilds` 字段填的是占位字符串（`'set this to true or false'`），会导致 prisma/sharp 等构建脚本被全部忽略。已改为 `true`，`pnpm rebuild` 后引擎下载、sharp 编译均成功。
- **PrismaClient 适配器**：`src/lib/db.ts` 当前为孤儿模块（未被 import），尚未接入 Prisma 7 要求的 `adapter`。若未来启用数据库，需在 `new PrismaClient()` 处补适配器（如 `@prisma/adapter-better-sqlite3`）。
- **registry 镜像**：本机到 `registry.npmjs.org` 路由极不稳定（曾 3–36 KiB/s、broken metadata），升级期间临时用 `npmmirror` 镜像完成，事后已删除临时 `.npmrc`，未改动项目原有 registry 配置。如常遇安装缓慢，建议在 `.npmrc` 配置国内镜像。

## 六、结论

依赖已全量升级至最新正式版（含 TypeScript 7.0.2），生产构建与类型检查均通过，所有可修复的破坏性变更已处理。唯一遗留为 `eslint` 因上游 typescript-eslint 尚未支持 TS7 而暂时不可用，属环境/上游时序问题，待其发版即可恢复。
