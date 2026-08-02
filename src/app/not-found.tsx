import Link from "next/link";
import { Compass } from "lucide-react";

/**
 * 404 降级页：未知路由或主动调用 notFound() 时展示。
 * 作为服务端组件，不引入客户端依赖，首屏零额外 JS。
 */
export default function NotFound() {
  return (
    <main className="relative min-h-screen flex items-center justify-center px-5">
      <div className="glass-strong rounded-3xl p-8 w-full max-w-md text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Compass className="h-7 w-7 text-primary" />
        </div>
        <h1 className="mb-2 text-xl font-semibold">页面走丢了</h1>
        <p className="mb-5 text-sm text-muted-foreground">
          你访问的链接不存在或已被移除。回到首页继续下载吧。
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-transform hover:scale-105"
        >
          返回首页
        </Link>
      </div>
    </main>
  );
}
