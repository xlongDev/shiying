<p align="right">
  <strong>English</strong> · <a href="./README.md">🇨🇳 简体中文</a>
</p>

<h1 align="center">Douyin Watermark-Free Downloader</h1>

<p align="center">
  Paste a Douyin share link to grab <strong>watermark-free videos</strong>, <strong>original images</strong>, and <strong>Live Photos</strong> — with inline playback, batch download, and image/video composition.
</p>

---

## Introduction

A **full-stack Next.js** tool for parsing Douyin content. Paste a share link and you get:

- Video parsing with the watermark removed, plus an inline player (seek / 0.5–2x speed / picture-in-picture / fullscreen / download).
- Image-post parsing: batch download of original images (JSZip) and background-music fetching.
- Live Photo parsing (single-image Live Photos and mixed image+Live galleries): extract the motion clip, with client-side `ffmpeg.wasm` image composition and server-side `ffmpeg` Live Photo composition.

The parser uses a **two-phase** flow: return base info fast, then load Live Photo resources asynchronously to avoid blocking the UI.

## ✨ Features

- **Video parsing** — watermark-free direct links and an inline player (scrub / 0.5–2x speed / PiP / fullscreen / download).
- **Image posts** — batch original-image download (JSZip) and background-music fetching.
- **Live Photos** — single-image and mixed image+Live galleries; extract motion clips; client-side `ffmpeg.wasm` composition and server-side `ffmpeg` Live Photo composition.
- **UX** — history, dark mode, glassmorphism UI, framer-motion animations, and accessibility (reduced-motion) support.

## 🧱 Tech Stack

| Layer | Tech |
| --- | --- |
| Framework | Next.js 16 (App Router) + React 19 + TypeScript 6 (strict) |
| Styling | Tailwind CSS v4 (CSS-first config), glassmorphism |
| Motion / Icons / Toasts | framer-motion · lucide-react · sonner |
| State | zustand + React hooks; `@radix-ui/*` a11y primitives |
| Media | `@ffmpeg/ffmpeg` (client wasm) / `ffmpeg` (server compose) / `jszip` (zip) |
| Live parsing | puppeteer-core + chrome-finder (auto-detect system Chrome) |
| Testing | Vitest 4 + Testing Library + Playwright (E2E) |
| Tooling | Oxlint 1 · Prettier 3 · Husky + lint-staged · pnpm 11.9 |

## 🚀 Quick Start

### Prerequisites

- Node.js ≥ 20 (22 recommended)
- pnpm **11.9.0** (pinned via the `packageManager` field)
- **System Chrome (core dependency)**: not only for Live Photo parsing — when the SSR path is blocked by WAF / geo-blocking (e.g. overseas IP), `/api/parse` also falls back to "real Chrome + iesdouyin mobile SSR" to fetch full data. Auto-detected by `chrome-finder`, or set `CHROME_PATH`.
- `ffmpeg` (for server-side Live Photo composition; provided via PATH in deployment, or placed at `bin/ffmpeg`)

### Install

```bash
pnpm install
```

### Develop

```bash
pnpm dev      # start dev server, defaults to http://localhost:3000
```

### Build & Run

```bash
pnpm build
pnpm start    # production mode
```

## 🧪 Tests & Quality Gates

```bash
pnpm test         # unit tests (Vitest)
pnpm test:watch   # watch mode
pnpm test:e2e     # end-to-end tests (Playwright)
pnpm typecheck    # TypeScript check (tsc --noEmit)
pnpm lint         # Oxlint
pnpm format:check # Prettier format check (CI gate)
```

> Before committing locally, run in order: `pnpm typecheck` → `pnpm lint` → `pnpm test` → `pnpm format:check` to match CI gates.

## 🔌 API Reference

All endpoints are Next.js Route Handlers (`src/app/api/`):

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/parse` | Main parse entry; supports `?skipLivePhoto=true` two-phase (returns base info first) |
| `POST` | `/api/parse-live-photo` | Async Live Photo resource loading (headless-browser parse) |
| `POST` | `/api/live-compose` | Server-side Live Photo composition (ffmpeg) |
| `GET` | `/api/download-music` | Image-post background-music download |
| `POST` | `/api/extract-audio` | Audio extraction |
| `GET` | `/api/proxy` | Generic proxy |
| `GET` | `/api/proxy-media` | Media proxy (Range requests, built-in SSRF protection) |
| `GET` | `/api/stream` | Streaming proxy |

## 🗂 Project Structure

```
src/
├── app/
│   ├── api/                  # route handlers (see table above)
│   │   ├── parse/  parse-live-photo/  live-compose/
│   │   ├── download-music/  extract-audio/
│   │   ├── proxy/  proxy-media/  stream/
│   │   └── route.ts
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── glass/                # glassmorphism player controls
│   │   ├── speed-menu.tsx
│   │   ├── glass-video-controls.tsx
│   │   └── glass-audio-controls.tsx
│   ├── download-button.tsx   # three-state download button (idle/downloading/done)
│   ├── live-photo-panel.tsx
│   ├── mixed-live-photo-card.tsx
│   ├── video-result.tsx
│   └── ... (UI components)
├── hooks/
│   ├── use-video-player.ts   # video playback state machine
│   ├── use-audio-player.ts   # audio playback state machine
│   ├── use-download-action.ts# generic download action state machine
│   ├── use-parse-video.ts
│   └── ...
└── lib/
    ├── parser/               # Douyin parser (modularized; index preserves the export)
    ├── live-photo-resolver.ts# Live Photo resolution
    ├── ffmpeg-compose.ts     # client-side image composition (ffmpeg.wasm)
    ├── chrome-finder.ts      # auto-detect system Chrome
    ├── logger.ts  rate-limit.ts  ssrf.ts  media-url.ts  format-time.ts
    └── utils.ts  sounds.ts
```

## 🚢 Deployment

- **Vercel**: import the repo for one-click deploy; no secrets required for base parsing. However, headless platforms like Vercel **do not provide Chrome**, so `/api/parse`'s browser fallback and Live Photo parsing degrade / fail — content blocked by WAF or overseas IPs may fail to parse. For full capability, self-host with Chrome installed.
- **Self-hosted**: `pnpm build && pnpm start`. Ensure the runtime provides **Chrome** (main-parse fallback + Live parsing) and **ffmpeg** (server compose).
- Media proxies ship with **SSRF protection** (`src/lib/ssrf.ts`) and **rate limiting** (`src/lib/rate-limit.ts`).

## ⚙️ Environment Variables

Base parsing needs no secrets. Optional:

- `CHROME_PATH`: manually point to the Chrome executable (otherwise auto-detected by `chrome-finder`).
- Server composition relies on `ffmpeg` in PATH, or `bin/ffmpeg` at repo root (git-ignored, not committed).
- Rate-limit and proxy policies: see `src/lib/rate-limit.ts` and `src/lib/ssrf.ts`.

> Keep secrets out of the repo; put local config in `.env.local` (already ignored).

## 📄 License

MIT License.
