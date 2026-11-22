"use client";

import { useEffect, useState } from "react";
import type { QuizEngine, Snapshot } from "@/lib/quizEngine";
import { LANGS } from "@/lib/types";
import { DemoPanel } from "./DemoPanel";
import { MapPanel } from "./MapPanel";
import { NextTurnStrip } from "./NextTurnStrip";
import { VoiceOrb } from "./VoiceOrb";

interface Props {
  engine: QuizEngine;
  s: Snapshot;
}

function stateLabel(s: Snapshot): string {
  if (s.phase === "PAUSED") return "Paused";
  if (s.phase === "JUDGE") return "Checking";
  if (s.listening) return "Listening";
  if (s.speaking && s.channel === "quiz") return "Asking";
  return "";
}

export function DriveScreen({ engine, s }: Props) {
  const [panel, setPanel] = useState(false);
  const route = engine.route;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "d" || e.key === "D") && !(e.target instanceof HTMLInputElement)) setPanel((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paused = s.phase === "PAUSED";
  const quiet = paused || s.phase === "IDLE";
  const label = stateLabel(s);

  return (
    <main className="screen drive">
      <div className="status-bar">
        <span className="chip">{LANGS.find((l) => l.code === s.lang)?.label}</span>
        {route && s.region >= 0 && <span className="chip">{route.regions[s.region].name[s.lang]}</span>}
      </div>

      {route && (
        <>
          <MapPanel
            route={route}
            lang={s.lang}
            variant="drive"
            progress={s.progress}
            nextManeuver={s.nextManeuver}
            zone={s.zone}
          />
          <NextTurnStrip
            maneuver={s.nextManeuver >= 0 ? route.maneuvers[s.nextManeuver] : null}
            progress={s.progress}
            lang={s.lang}
          />
        </>
      )}

      <VoiceOrb
        voice={engine.voice}
        speaking={s.speaking}
        listening={s.listening}
        paused={paused}
        channel={s.channel}
        compact={route !== null}
      />

      <section className={`captions ${route ? "compact" : ""}`} aria-live="polite">
        <div className="caption-host">{s.hostText}</div>
        <div className={`caption-user ${s.userInterim ? "interim" : ""}`}>{s.userText}</div>
      </section>

      <div className="state-row">
        <span>{label}</span>
        <span>
          Correct answers<b>{s.correct}</b>
        </span>
      </div>

      <div className="controls">
        <button className="primary" onClick={() => engine.pauseResume()}>
          {quiet ? "Resume" : "Pause"}
        </button>
        <button onClick={() => engine.skip()} disabled={paused}>
          Skip
        </button>
        <button onClick={() => engine.stop()}>Stop</button>
      </div>

      {panel && <DemoPanel engine={engine} s={s} onClose={() => setPanel(false)} />}
    </main>
  );
}
