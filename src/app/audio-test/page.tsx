"use client";

import { GlassAudioControls } from "@/components/glass-audio-controls";

export default function AudioTestPage() {
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
