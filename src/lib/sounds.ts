/**
 * 基于 Web Audio API 的程序化音效引擎
 */

type SoundName =
  "detect" | "start" | "complete" | "error" | "click" | "toggle" | "hover" | "paste" | "success";

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled = true;
  private volume = 0.5;

  constructor() {
    if (typeof window !== "undefined") {
      try {
        this.enabled = localStorage.getItem("sound-enabled") !== "false";
        const v = localStorage.getItem("sound-volume");
        if (v) this.volume = parseFloat(v);
      } catch {}
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.volume;
        this.masterGain.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("sound-enabled", String(v));
      } catch {}
    }
  }

  isEnabled() {
    return this.enabled;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain) this.masterGain.gain.value = this.volume;
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("sound-volume", String(this.volume));
      } catch {}
    }
  }

  getVolume() {
    return this.volume;
  }

  private playTone(
    freq: number,
    startTime: number,
    duration: number,
    type: OscillatorType = "sine",
    gain = 0.3
  ) {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, startTime);
    env.gain.linearRampToValueAtTime(gain, startTime + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(env);
    env.connect(this.masterGain);
    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  private playInternal(name: SoundName) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    switch (name) {
      case "detect": {
        this.playTone(523.25, now, 0.1, "sine", 0.2);
        this.playTone(659.25, now + 0.08, 0.15, "sine", 0.2);
        break;
      }
      case "start": {
        this.playTone(440, now, 0.08, "sine", 0.2);
        this.playTone(660, now + 0.08, 0.15, "sine", 0.2);
        break;
      }
      case "complete": {
        this.playTone(523.25, now, 0.12, "sine", 0.25);
        this.playTone(659.25, now + 0.1, 0.12, "sine", 0.25);
        this.playTone(783.99, now + 0.2, 0.12, "sine", 0.25);
        this.playTone(1046.5, now + 0.3, 0.4, "sine", 0.3);
        this.playTone(1318.5, now + 0.3, 0.4, "triangle", 0.12);
        break;
      }
      case "success": {
        this.playTone(880, now, 0.08, "sine", 0.2);
        this.playTone(1320, now + 0.06, 0.15, "sine", 0.2);
        break;
      }
      case "error": {
        this.playTone(440, now, 0.15, "sawtooth", 0.15);
        this.playTone(330, now + 0.12, 0.25, "sawtooth", 0.15);
        this.playTone(220, now + 0.24, 0.3, "sine", 0.2);
        break;
      }
      case "click": {
        this.playTone(1200, now, 0.04, "sine", 0.15);
        break;
      }
      case "toggle": {
        this.playTone(660, now, 0.06, "sine", 0.18);
        this.playTone(880, now + 0.05, 0.08, "sine", 0.18);
        break;
      }
      case "hover": {
        this.playTone(2000, now, 0.03, "sine", 0.05);
        break;
      }
      case "paste": {
        this.playTone(800, now, 0.05, "sine", 0.12);
        this.playTone(1000, now + 0.04, 0.06, "sine", 0.12);
        break;
      }
    }
  }

  play(name: SoundName) {
    if (!this.enabled) return;
    this.playInternal(name);
  }

  playForce(name: SoundName) {
    this.playInternal(name);
  }
}

let engine: SoundEngine | null = null;

export function getSoundEngine(): SoundEngine {
  if (!engine) engine = new SoundEngine();
  return engine;
}

export type { SoundName };
