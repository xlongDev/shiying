# 自托管部署（Self-host）

本项目已定为**纯自托管单实例**部署模型：`vercel.json` 已移除。解析后端依赖系统
Chrome（见 `src/lib/browser-pool.ts`），因此**必须运行在装有 Chrome 的机器上**，
无法部署到无系统浏览器的 serverless 环境（如 Vercel 免费版）。

## 方式一：Docker（推荐，跨平台一致）

```bash
docker build -t shiying .
docker run -d --name shiying -p 3000:3000 shiying
```

镜像内已安装 Chromium、ffmpeg 与 Python 的 `makelive`，由相关探测逻辑自动识别，无需额外配置。
如需自定义 Chrome 路径，可挂载并设置环境变量 `CHROME_PATH=/path/to/chrome`。

## 方式二：原生 Node（本机 / 家庭服务器 / 免费 VM）

```bash
pnpm install
pnpm build
pnpm start      # 监听 3000
```

前置条件：
- 系统 Chrome（或设置 `CHROME_PATH`）——无头浏览器实况兜底；
- `ffmpeg` ——服务端转码与音频提取；
- Python 3 + `makelive`（`pip install makelive`）——「保存为苹果实况照片」功能依赖。
  三者缺一时对应能力自动降级（`/api/health` 的 `appleLivePhoto` 字段为 `false`，UI 隐藏入口）。

## 免费且永不停机的落地建议

- **家庭服务器 / NAS / 树莓派 / 旧 PC + Cloudflare Tunnel**：免费公网 HTTPS，
  无需公网 IP / 端口转发，浏览器热池常驻，体验最好。
- **Oracle Cloud Always Free** ARM VM（4 核 / 24G，永久免费）：装 Docker 后跑上述镜像。

> 避免 Render / Railway 免费档：实例闲置会睡眠，热 Chrome 池冷掉，首次请求白等 8s+。

## 环境变量

详见 `.env.example`。核心几项：

- `CHROME_PATH` / `PUPPETEER_EXECUTABLE_PATH`：显式指定 Chrome（不设则自动探测）。
- `LIVE_PHOTO_SERVICE_URL` + `LIVE_PHOTO_SERVICE_TOKEN`：可选，国内 a_bogus 签名桥
  （零浏览器实况解析；自托管且有 Chrome 时通常不需要）。
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`：可选，跨实例限流。
- `LOG_LEVEL`：日志级别（默认 `info`）。

## 健康检查

`GET /api/health` 返回 `{ ok, chrome, livePhotoService, appleLivePhoto, degraded, message }`，
可据此判断解析后端是否可用（无 Chrome 且无服务桥时 `degraded: true`；`appleLivePhoto` 表示能否保存苹果实况照片）。
