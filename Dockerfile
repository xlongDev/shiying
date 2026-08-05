# 时影（抖音解析器）自托管镜像
#
# 构建：docker build -t shiying .
# 运行：docker run -d --name shiying -p 3000:3000 shiying
#
# 解析后端依赖系统 Chromium（无头浏览器兜底，见 src/lib/browser-pool.ts），
# 镜像内已安装 Chromium 与 ffmpeg，由 chrome-finder 自动探测，无需额外配置。

FROM node:22-slim

WORKDIR /app

# 系统依赖：Chromium（无头浏览器兜底）/ ffmpeg（服务端转码 + 音频提取）/
# python3 + pip（苹果实况照片打包 makelive）/ curl（容器健康检查）
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ffmpeg python3 python3-pip curl \
  && rm -rf /var/lib/apt/lists/*

# 苹果实况照片（.pvt）打包依赖：makelive（把 JPG + MOV 合成 .pvt 目录）
RUN python3 -m pip install --no-cache-dir makelive

# pnpm 由 corepack 提供，版本锁定于 package.json 的 packageManager 字段
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

# 依赖（先拷清单以利用层缓存）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# 源码与构建
COPY . .
RUN pnpm build

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

# 健康检查：/api/health 始终返回 2xx，作为存活探针；
# start-period 预留 Next.js 冷启动与首请求 JIT 编译时间。
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

CMD ["pnpm", "start"]
