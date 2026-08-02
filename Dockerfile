# 时影（抖音解析器）自托管镜像
#
# 构建：docker build -t shiying .
# 运行：docker run -d --name shiying -p 3000:3000 shiying
#
# 解析后端依赖系统 Chromium（无头浏览器兜底，见 src/lib/browser-pool.ts），
# 镜像内已安装 Chromium 与 ffmpeg，由 chrome-finder 自动探测，无需额外配置。

FROM node:22-slim

WORKDIR /app

# 系统依赖：Chromium（无头浏览器兜底）/ ffmpeg（服务端音频提取）
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ffmpeg \
  && rm -rf /var/lib/apt/lists/*

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
CMD ["pnpm", "start"]
