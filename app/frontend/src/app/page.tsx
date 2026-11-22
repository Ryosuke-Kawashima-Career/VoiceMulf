"use client";

import { useEffect, useState } from "react";
import { DriveScreen } from "@/components/DriveScreen";
import { HomeScreen } from "@/components/HomeScreen";
import { SummaryScreen } from "@/components/SummaryScreen";
import { QuizEngine, type Snapshot } from "@/lib/quizEngine";
import type { Lang, Route } from "@/lib/types";

export default function Page() {
  const [screen, setScreen] = useState<"home" | "drive" | "summary">("home");
  const [lang, setLang] = useState<Lang>("hi-IN");
  const [route, setRoute] = useState<Route | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [engine, setEngine] = useState<QuizEngine | null>(null);

  useEffect(() => () => engine?.dispose(), [engine]);

  /** Starts a drive with the route from the Home preview (or no route). */
  function drive(l: Lang, r: Route | null) {
    setLang(l);
    setRoute(r);
    const next = new QuizEngine(l, r);
    next.subscribe((s) => {
      setSnap(s);
      if (s.phase === "ENDED") setScreen("summary");
    });
    setSnap(next.s);
    setEngine(next);
    setScreen("drive");
    void next.start();
  }

  function home() {
    setEngine(null);
    setScreen("home");
  }

  if (screen === "drive" && engine && snap) return <DriveScreen engine={engine} s={snap} />;
  if (screen === "summary" && snap) {
    return <SummaryScreen s={snap} route={route} onPlayAgain={() => drive(lang, route)} onHome={home} />;
  }
  return <HomeScreen initialLang={lang} onStart={(c) => drive(c.lang, c.route)} />;
}
