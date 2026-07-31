import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 服务端原生 / wasm 依赖排除 webpack 打包（避免 Vercel 上打包失败或产物体积爆炸）。
  // puppeteer-core 会动态拉起系统 Chrome；@ffmpeg/* 与 jszip 含 wasm / 二进制资源，
  // 交由 Node 运行时原生 require 更稳妥。
  serverExternalPackages: [
    "puppeteer-core",
    "@sparticuz/chromium",
    "@ffmpeg/ffmpeg",
    "@ffmpeg/util",
    "@ffmpeg/core",
    "jszip",
  ],
};

export default nextConfig;
