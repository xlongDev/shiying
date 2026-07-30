"use client";

import * as React from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useSound } from "@/components/sound-manager";

export function SoundToggle() {
  const { enabled, setEnabled, volume, setVolume, play, playForce } = useSound();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          play("click");
          setOpen(!open);
        }}
        className="h-10 w-10 rounded-full glass glass-shine flex items-center justify-center"
        aria-label="音效设置"
      >
        {enabled ? (
          <Volume2 className="h-5 w-5 text-primary" />
        ) : (
          <VolumeX className="h-5 w-5 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-64 glass-strong rounded-2xl p-4 shadow-xl">
          {/* 开关 */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium">音效</span>
            <button
              type="button"
              onClick={() => setEnabled(!enabled)}
              className={`relative h-7 w-12 rounded-full transition-colors ${
                enabled ? "bg-primary" : "bg-muted"
              }`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-md transition-all ${
                  enabled ? "left-6" : "left-1"
                }`}
              />
            </button>
          </div>

          {/* 音量 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>音量</span>
              <span>{Math.round(volume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(e) => setVolume(parseInt(e.target.value) / 100)}
              className="w-full h-2 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, var(--primary) ${volume * 100}%, var(--muted) ${volume * 100}%)`,
              }}
            />
          </div>

          {/* 试听 */}
          <div className="mt-4 pt-3 border-t border-border/50">
            <p className="text-xs text-muted-foreground mb-2">试听音效</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { name: "detect" as const, label: "识别" },
                { name: "start" as const, label: "开始" },
                { name: "complete" as const, label: "完成" },
                { name: "error" as const, label: "错误" },
              ].map(({ name, label }) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => playForce(name)}
                  className="text-xs py-1.5 rounded-lg glass hover:bg-primary/10 transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
