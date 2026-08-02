/**
 * 集中式配置（单一 env 收口点）。
 *
 * 设计目标（架构评审 #48）：
 * - 所有 `process.env` 读取收口到本模块，后续切换部署形态（自托管 / serverless /
 *   国内服务桥）只需改这一个文件，不必在代码里大海捞针；
 * - 全部使用**惰性 getter**，避免在模块加载期缓存 env，保证单元测试可在运行时
 *   改写 env（live-photo-resolver-service.test.ts 即依赖此特性）；
 * - 纯服务端模块，禁止在客户端组件 import，避免泄露服务端密钥。
 *
 * 变量分组：
 *   chrome   —— 无头浏览器路径探测（自托管核心依赖）
 *   services —— 国内 a_bogus 签名桥（serverless / Vercel 的实况解析替代路径）
 *   upstash  —— 跨实例限流后端（可选，不装依赖则回退内存）
 *   logging  —— 日志级别
 *   features —— 功能开关
 */

function readString(name: string, fallback: string | null = null): string | null {
  const v = process.env[name];
  return v == null || v.trim() === "" ? fallback : v;
}

function readBool(name: string): boolean {
  return process.env[name] === "true";
}

export const config = {
  chrome: {
    /**
     * 显式指定的 Chrome 可执行文件。空则返回 null，交由 chrome-finder 路径探测。
     * 自托管部署请设置 PUPPETEER_EXECUTABLE_PATH 或 CHROME_PATH。
     */
    get executablePath(): string | null {
      return readString("PUPPETEER_EXECUTABLE_PATH") ?? readString("CHROME_PATH");
    },
    get localAppData(): string | undefined {
      return process.env.LOCALAPPDATA;
    },
    get programFiles(): string | undefined {
      return process.env.PROGRAMFILES;
    },
    get programFilesX86(): string | undefined {
      return process.env["PROGRAMFILES(X86)"];
    },
  },

  services: {
    /**
     * 国内 IP 的 a_bogus 签名桥基址；配置后实况解析可零浏览器（Vercel 上 slides
     * 实况的唯一可行来源）。未配置则交由 SSR / 本地 Chrome 兜底。
     */
    get livePhotoServiceUrl(): string | null {
      return readString("LIVE_PHOTO_SERVICE_URL");
    },
    /** 国内服务 Bearer Token 鉴权；为空则不带鉴权头。 */
    get livePhotoServiceToken(): string | null {
      return readString("LIVE_PHOTO_SERVICE_TOKEN");
    },
  },

  upstash: {
    get url(): string | null {
      return readString("UPSTASH_REDIS_REST_URL");
    },
    get token(): string | null {
      return readString("UPSTASH_REDIS_REST_TOKEN");
    },
  },

  logging: {
    /** 日志阈值：debug < info < warn < error，默认 info。 */
    get level(): string {
      return (readString("LOG_LEVEL") ?? "info").toLowerCase();
    },
  },

  features: {
    /** 关闭实况照片解析（设 true 则完全跳过实况探测，仅保留基础视频/图文解析）。 */
    get disableLivePhotoResolve(): boolean {
      return readBool("DISABLE_LIVE_PHOTO_RESOLVE");
    },
  },
};

export type AppConfig = typeof config;
