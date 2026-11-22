"use client";

import type { Snapshot } from "@/lib/quizEngine";
import { PHRASES } from "@/lib/i18n";
import type { Route } from "@/lib/types";

interface Props {
  s: Snapshot;
  route: Route | null;
  onPlayAgain: () => void;
  onHome: () => void;
}

export function SummaryScreen({ s, route, onPlayAgain, onHome }: Props) {
  const passed = route
    ? [
        ...route.landmarks
          .map((l, i) => ({ name: l.name[s.lang], at: l.at_m, ok: s.landmarkStatus[i] === "correct" }))
          .filter((x) => s.progress >= x.at),
        ...route.regions
          .map((g, i) => ({ name: g.name[s.lang], at: g.enter_at_m, ok: s.regionStatus[i] === "correct" }))
          .filter((x) => s.progress >= x.at),
      ].sort((a, b) => a.at - b.at)
    : [];

  return (
    <main className="screen summary">
      <h1>Trip summary</h1>

      <div className="stats">
        <div className="stat">
          <div className="v">{s.asked}</div>
          <div className="l">Questions asked</div>
        </div>
        <div className="stat">
          <div className="v">{s.correct}</div>
          <div className="l">Correct answers</div>
        </div>
      </div>

      {route && (
        <div className="stat">
          <div className="l">Landmarks and regions passed</div>
          {passed.length ? (
            <ul className="passed">
              {passed.map((p) => (
                <li key={p.name}>
                  <span>{p.name}</span>
                  {p.ok && <span className="ok">✓ answered</span>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="v small">-</div>
          )}
        </div>
      )}

      <div className="closing">{PHRASES[s.lang].closing}</div>

      <div className="summary-actions">
        <button className="primary" onClick={onPlayAgain}>
          Play again
        </button>
        <button onClick={onHome}>Home</button>
      </div>
    </main>
  );
}
