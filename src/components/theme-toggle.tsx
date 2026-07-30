"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useSound } from "@/components/sound-manager";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { play } = useSound();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-10 w-10 rounded-full glass" aria-hidden />;
  }

  const isDark = resolvedTheme === "dark";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <motion.button
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => play("click")}
          className="relative h-10 w-10 rounded-full glass glass-shine flex items-center justify-center overflow-hidden"
          aria-label="切换主题"
        >
          <AnimatePresence mode="wait" initial={false}>
            {isDark ? (
              <motion.div
                key="moon"
                initial={{ y: -20, opacity: 0, rotate: -90 }}
                animate={{ y: 0, opacity: 1, rotate: 0 }}
                exit={{ y: 20, opacity: 0, rotate: 90 }}
                transition={{ duration: 0.3 }}
              >
                <Moon className="h-5 w-5 text-primary" />
              </motion.div>
            ) : (
              <motion.div
                key="sun"
                initial={{ y: -20, opacity: 0, rotate: 90 }}
                animate={{ y: 0, opacity: 1, rotate: 0 }}
                exit={{ y: 20, opacity: 0, rotate: -90 }}
                transition={{ duration: 0.3 }}
              >
                <Sun className="h-5 w-5 text-amber-500" />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="glass-strong rounded-2xl min-w-[140px] p-1">
        {(
          [
            { key: "light", label: "浅色", icon: Sun },
            { key: "dark", label: "暗夜", icon: Moon },
            { key: "system", label: "跟随系统", icon: Monitor },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <DropdownMenuItem
            key={key}
            onClick={() => {
              setTheme(key);
              play("toggle");
            }}
            className={`rounded-xl cursor-pointer flex items-center gap-2 px-3 py-2 ${
              theme === key ? "bg-primary/15 text-primary" : ""
            }`}
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
            {theme === key && (
              <motion.div
                layoutId="theme-active"
                className="ml-auto h-1.5 w-1.5 rounded-full bg-primary"
              />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
