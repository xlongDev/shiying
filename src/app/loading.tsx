/**
 * 路由级加载兜底：页面子树在流式渲染/导航时产生的 Suspense 占位。
 * 作为服务端组件，仅输出静态骨架，不引入客户端依赖。
 */
export default function Loading() {
  return (
    <main className="relative min-h-screen flex flex-col items-center px-5 sm:px-8 pt-12 sm:pt-20 pb-8">
      <div className="mx-auto w-full max-w-4xl">
        {/* 标题占位 */}
        <div className="mb-8 space-y-3 text-center">
          <div className="mx-auto h-12 w-48 max-w-[60%] animate-pulse rounded-2xl bg-muted" />
          <div className="mx-auto h-4 w-64 max-w-[50%] animate-pulse rounded-full bg-muted" />
        </div>

        {/* 输入框占位 */}
        <div className="mx-auto h-14 w-full max-w-xl animate-pulse rounded-full bg-muted" />

        {/* 结果区占位 */}
        <div className="glass-strong mx-auto mt-8 h-64 w-full max-w-2xl animate-pulse rounded-3xl" />
      </div>
    </main>
  );
}
