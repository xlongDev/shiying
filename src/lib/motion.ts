import type { Variants } from "framer-motion";

/** expo-out 缓动：快出慢停，入场动效的默认曲线 */
export const EASE_EXPO: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** 滚动 reveal 父容器：标题 + 子卡片统一错峰进入（staggerChildren） */
export const revealContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.1, delayChildren: 0.08 },
  },
};

/** 滚动 reveal 子项：fade + 上浮，仅用 transform/opacity（GPU 友好） */
export const revealItem: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE_EXPO } },
};
