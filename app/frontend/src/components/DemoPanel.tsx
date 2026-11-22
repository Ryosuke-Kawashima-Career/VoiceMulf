"use client";

import { useState } from "react";
import type { QuizEngine, Snapshot } from "@/lib/quizEngine";
import { SPEEDS } from "@/lib/replay";

interface Props {
  engine: QuizEngine;
  s: Snapshot;
  onClose: () => void;
}

/** Operator-only panel (spec 4.4), toggled with the D key. */
export function DemoPanel({ engine, s, onClose }: Props) {
  const [showDebug, setShowDebug] = useState(false);
  const [typed, setTyped] = useState("");
  const hasRoute = engine.route !== null;

  return (
    <aside className="demo-panel" aria-label="Demo Panel">
      <h2>
        Demo Panel
        <button className="icon-btn" onClick={onClose} aria-label="Close Demo Panel">
          ✕
        </button>
      </h2>

      {hasRoute && (
        <>
          <div className="demo-row">
            <button className="wide" onClick={() => engine.togglePlay()}>
              {s.playing ? "Pause car" : "Play car"}
            </button>
            {SPEEDS.map((sp) => (
              <button key={sp} aria-pressed={s.speed === sp} onClick={() => engine.setSpeed(sp)}>
                {sp}x
              </button>
            ))}
          </div>
          <div className="demo-row">
            <button onClick={() => engine.jumpTo("turn")}>Next turn</button>
            <button onClick={() => engine.jumpTo("landmark")}>Next landmark</button>
            <button onClick={() => engine.jumpTo("region")}>Next region</button>
          </div>
        </>
      )}

      <form
        className="demo-row"
        onSubmit={(e) => {
          e.preventDefault();
          engine.typeAnswer(typed);
          setTyped("");
        }}
      >
        <input
          className="text-input"
          style={{ flex: "1 1 160px", minHeight: 44 }}
          placeholder="Type an answer or command"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button type="submit" style={{ flex: "0 0 auto" }}>
          Send
        </button>
      </form>

      <label className="check">
        <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} />
        Debug
      </label>

      {showDebug && (
        <div className="debug">
          <div>
            <span className="k">voice</span>
            {s.voiceSource === "browser" ? "browser speechSynthesis (fallback)" : s.voiceSource === "murf" ? "Murf Falcon" : "-"}
          </div>
          <div>
            <span className="k">state</span>
            {s.phase}
            {hasRoute && ` · ${Math.round(s.progress)} m`}
          </div>
          {s.debug.map((d, i) => (
            <div key={d.at + "-" + i}>
              <span className={`k ${d.kind}`}>{d.kind}</span>
              {d.text}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
