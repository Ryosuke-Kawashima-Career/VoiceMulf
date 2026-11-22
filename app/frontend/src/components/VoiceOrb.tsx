"use client";

import { useEffect, useRef } from "react";
import type { HostVoice } from "@/lib/tts";

interface Props {
  voice: HostVoice;
  speaking: boolean;
  listening: boolean;
  paused: boolean;
  channel: "directions" | "quiz";
  compact: boolean;
}

/** Grows with the host's voice level, pulses while listening, still when paused. Labelled Directions / Quiz. */
export function VoiceOrb({ voice, speaking, listening, paused, channel, compact }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!speaking) {
      if (ref.current) ref.current.style.transform = "";
      return;
    }
    let raf = 0;
    let smooth = 0;
    const loop = () => {
      smooth = smooth * 0.7 + voice.level() * 0.3;
      if (ref.current) ref.current.style.transform = `scale(${1 + smooth * 0.22})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [speaking, voice]);

  const cls = ["orb", channel === "directions" ? "directions" : "", paused ? "paused" : "", listening && !paused ? "listening" : ""].join(" ");
  return (
    <div className={`orb-wrap ${compact ? "compact" : ""}`}>
      <div ref={ref} className={cls} aria-hidden />
      <div className={`orb-label ${channel}`}>{channel === "directions" ? "Directions" : "Quiz"}</div>
    </div>
  );
}
