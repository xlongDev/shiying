// 向后兼容 barrel：live-photo-resolver 的拆分见 ./live-photo/*
// （types / detect / service / ssr / chrome / resolver）。
//
// 调用方（parse / download-music / parse-live-photo / parser/note / parser/slides）
// 仍可从此处导入，无需改动。后续如需逐步收敛，可把调用方改为直接从
// ./live-photo/{resolver,ssr,service} 引入具体符号。
export * from "./live-photo/types";
export * from "./live-photo/detect";
export * from "./live-photo/ssr";
export * from "./live-photo/service";
export * from "./live-photo/resolver";

// 历史 re-export：parser/extract 的 SSR 解析辅助函数也曾从这里导出，保留以兼容老测试。
export { extractRouterData, findItemInRouterData } from "./parser/extract";
