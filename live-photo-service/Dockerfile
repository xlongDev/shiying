# 抖音实况照片解析服务镜像
# 零浏览器方案：a_bogus 纯 Node 签名，仅需 Node 运行时，镜像极小。
# 必须部署在【国内 IP】节点，否则抖音地理封锁会返回空响应。
FROM node:20-alpine

WORKDIR /app

# 仅复制源码（无 npm 依赖，无需 install）
COPY package.json ./
COPY lib.js ./
COPY server.js ./
COPY abogus-vendor.js ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
