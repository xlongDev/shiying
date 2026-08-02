<p align="right">
  <a href="./README.en.md">🇺🇸 English</a> · <strong>简体中文</strong>
</p>

<h1 align="center">抖音无水印解析器</h1>

<p align="center">
  输入抖音分享链接，一键获取<strong>无水印视频</strong>、<strong>图文原图</strong>与<strong>实况照片</strong>资源，支持在线播放、批量下载与图文合成。
</p>

---

## 项目简介

一个基于 **Next.js 全栈** 的抖音内容解析工具。粘贴分享链接即可：

- 解析普通视频，去除水印并提供在线播放（倍速 / 画中画 / 全屏 / 下载）；
- 解析图文帖，批量下载原图、获取背景音乐；
- 解析实况照片（单图实况与混合图文实况），提取动态短片并支持客户端图文合成。

解析流程采用**两阶段**设计：先快速返回基础信息，再异步加载实况资源，避免界面长时间阻塞。

## ✨ 功能特性

- **视频解析**：无水印直链、在线播放器（进度拖拽 / 倍速 0.5–2x / 画中画 / 全屏 / 下载）。
- **图文帖**：原图批量打包下载（JSZip）、背景音乐获取。
- **实况照片**：单图实况 + 混合图文实况，提取动态短片；支持客户端 `ffmpeg.wasm` 图文合成与服务端 `ffmpeg` 实况合成。
- **体验**：历史记录、深色模式、玻璃拟态 UI、framer-motion 动效与无障碍（reduced-motion）支持。

## 🧱 技术栈

| 层 | 技术 |
| --- | --- |
| 框架 | Next.js 16（App Router）+ React 19 + TypeScript 6（strict） |
| 样式 | Tailwind CSS v4（CSS-first 配置），玻璃拟态设计 |
| 动效 / 图标 / 提示 | framer-motion · lucide-react · sonner |
| 状态 | zustand + React hooks；`@radix-ui/*` 无障碍原语 |
| 媒体处理 | `@ffmpeg/ffmpeg`（客户端 wasm）/ `ffmpeg`（服务端合成）/ `jszip`（打包） |
| 实况解析 | puppeteer-core + chrome-finder（自动探测系统 Chrome） |
| 测试 | Vitest 4 + Testing Library + Playwright（E2E） |
| 工程化 | ESLint 10 · Prettier 3 · Husky + lint-staged · pnpm 11.9 |

## 🚀 快速开始

### 环境要求

- Node.js ≥ 20（推荐 22）
- pnpm **11.9.0**（由 `packageManager` 字段锁定）
- **系统 Chrome（核心依赖）**：不仅实况解析需要，`/api/parse` 主解析在 SSR 被 WAF / 地理封锁（如海外 IP）时，也会回退到「真实 Chrome + iesdouyin 移动端 SSR」提取完整数据。由 `chrome-finder` 自动探测，也可用 `CHROME_PATH` 指定。
- `ffmpeg`（服务端实况合成用，由部署环境 PATH 提供，或置于 `bin/ffmpeg`）

### 安装

```bash
pnpm install
```

### 本地开发

```bash
pnpm dev      # 启动开发服务器，默认 http://localhost:3000
```

### 构建与启动

```bash
pnpm build
pnpm start    # 生产模式运行
```

## 🧪 测试与质量门禁

```bash
pnpm test         # 单元测试（Vitest）
pnpm test:watch   # 监视模式
pnpm test:e2e     # 端到端测试（Playwright）
pnpm typecheck    # TypeScript 类型检查（tsc --noEmit）
pnpm lint         # ESLint
pnpm format:check # Prettier 格式检查（CI 卡点）
```

> 本地提交前建议依次跑：`pnpm typecheck` → `pnpm lint` → `pnpm test` → `pnpm format:check`，与 CI 门禁保持一致。

## 🔌 API 接口

所有接口均为 Next.js Route Handlers（`src/app/api/`）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/parse` | 主解析入口，支持 `?skipLivePhoto=true` 两阶段（先返回基础信息） |
| `POST` | `/api/parse-live-photo` | 异步加载实况照片资源（无头浏览器解析） |
| `POST` | `/api/live-compose` | 服务端实况合成（ffmpeg） |
| `GET` | `/api/download-music` | 图文帖背景音乐下载 |
| `POST` | `/api/extract-audio` | 音频提取 |
| `GET` | `/api/proxy` | 通用代理 |
| `GET` | `/api/proxy-media` | 媒体代理（支持 Range 请求，内置 SSRF 防护） |
| `GET` | `/api/stream` | 流媒体代理 |

## 🗂 项目结构

```
src/
├── app/
│   ├── api/                  # 路由处理器（见上表）
│   │   ├── parse/  parse-live-photo/  live-compose/
│   │   ├── download-music/  extract-audio/
│   │   ├── proxy/  proxy-media/  stream/
│   │   └── route.ts
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── glass/                # 玻璃拟态播放器控件
│   │   ├── speed-menu.tsx
│   │   ├── glass-video-controls.tsx
│   │   └── glass-audio-controls.tsx
│   ├── download-button.tsx   # 三态下载按钮（idle/downloading/done）
│   ├── live-photo-panel.tsx
│   ├── mixed-live-photo-card.tsx
│   ├── video-result.tsx
│   └── ...（UI 组件）
├── hooks/
│   ├── use-video-player.ts   # 视频播放状态机
│   ├── use-audio-player.ts   # 音频播放状态机
│   ├── use-download-action.ts# 通用下载动作状态机
│   ├── use-parse-video.ts
│   └── ...
└── lib/
    ├── parser/               # 抖音解析器（拆分模块化，index 保持出口）
    ├── live-photo-resolver.ts# 实况照片解析
    ├── ffmpeg-compose.ts     # 客户端图文合成（ffmpeg.wasm）
    ├── chrome-finder.ts      # 自动查找系统 Chrome
    ├── logger.ts  rate-limit.ts  ssrf.ts  media-url.ts  format-time.ts
    └── utils.ts  sounds.ts
```

## 🚢 部署

- **Vercel**：直接导入仓库一键部署；无需额外密钥即可运行基础解析。但 Vercel 等**无头环境不提供 Chrome**，因此 `/api/parse` 的浏览器兜底与实况照片解析会降级失效——海外 IP / 被 WAF 拦截的内容可能解析失败。如需完整能力，请自托管并安装 Chrome。
- **自托管**：`pnpm build && pnpm start`。需保证运行环境提供 **Chrome**（主解析兜底 + 实况解析）与 **ffmpeg**（服务端合成）。
- 媒体代理内置 **SSRF 防护**（`src/lib/ssrf.ts`），并带**速率限制**（`src/lib/rate-limit.ts`）。

## ⚙️ 环境变量

基础解析无需任何密钥。可选：

- `CHROME_PATH`：手动指定 Chrome 可执行文件路径（缺省时由 `chrome-finder` 自动探测）。
- 服务端合成依赖环境 PATH 中的 `ffmpeg`，或放置在仓库 `bin/ffmpeg`（已被 `.gitignore` 忽略，不入库）。
- 速率限制与代理策略见 `src/lib/rate-limit.ts` 与 `src/lib/ssrf.ts`。

> 敏感信息请勿提交；本地配置放入 `.env.local`（已忽略）。

## 📄 许可证

MIT License。
