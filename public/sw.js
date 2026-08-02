// 极简无操作 Service Worker
// 本应用不主动注册 Service Worker；此文件仅为消除开发/运行环境对 /sw.js 的 404 请求噪音。
// 即使被某些浏览器扩展或环境注册，它也不含 fetch 事件处理，所有网络请求将按默认行为正常透传，不会缓存或拦截。
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
