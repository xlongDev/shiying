import { notFound } from "next/navigation";
import { config } from "@/lib/config";
import { GlassAudioControls } from "@/components/glass-audio-controls";

// 诊断/调试页面：默认关闭，仅当 ENABLE_DIAGNOSTICS=true 才渲染（否则返回 404）。
// 与 /api/abogus-test 一致，避免生产环境暴露调试 UI、缩减攻击面。
export const dynamic = "force-dynamic";

export default function AudioTestPage() {
  if (!config.features.enableDiagnostics) {
    notFound();
  }

  return (
    <div className="min-h-screen p-8 space-y-8 bg-[#f5f3ff]">
      <section id="light-section" className="space-y-4">
        <h1 className="text-slate-800 font-medium">Light theme</h1>
        <GlassAudioControls src="/test-tone.wav" />
      </section>

      <section id="dark-section" className="dark bg-[#0a0a14] p-8 rounded-2xl space-y-4">
        <h1 className="text-white/80 font-medium">Dark theme</h1>
        <GlassAudioControls src="/test-tone.wav" />
      </section>
    </div>
  );
}
