"use client";

import * as React from "react";
import { getSoundEngine, type SoundName } from "@/lib/sounds";

interface SoundContextValue {
  play: (name: SoundName) => void;
  playForce: (name: SoundName) => void;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  volume: number;
  setVolume: (v: number) => void;
}

const SoundContext = React.createContext<SoundContextValue | null>(null);

export function SoundManager({ children }: { children?: React.ReactNode }) {
  const engine = React.useMemo(() => getSoundEngine(), []);
  const [enabled, setEnabledState] = React.useState(true);
  const [volume, setVolumeState] = React.useState(0.5);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    setEnabledState(engine.isEnabled());
    setVolumeState(engine.getVolume());
  }, [engine]);

  const play = React.useCallback(
    (name: SoundName) => {
      if (!mounted) return;
      engine.play(name);
    },
    [engine, mounted]
  );

  const playForce = React.useCallback(
    (name: SoundName) => {
      engine.playForce(name);
    },
    [engine]
  );

  const setEnabled = React.useCallback(
    (v: boolean) => {
      engine.setEnabled(v);
      setEnabledState(v);
      if (v) engine.playForce("toggle");
    },
    [engine]
  );

  const setVolume = React.useCallback(
    (v: number) => {
      engine.setVolume(v);
      setVolumeState(v);
    },
    [engine]
  );

  const value = React.useMemo(
    () => ({ play, playForce, enabled, setEnabled, volume, setVolume }),
    [play, playForce, enabled, setEnabled, volume, setVolume]
  );

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

export function useSound() {
  const ctx = React.useContext(SoundContext);
  if (!ctx) {
    return {
      play: () => {},
      playForce: () => {},
      enabled: true,
      setEnabled: () => {},
      volume: 0.5,
      setVolume: () => {},
    } as SoundContextValue;
  }
  return ctx;
}
