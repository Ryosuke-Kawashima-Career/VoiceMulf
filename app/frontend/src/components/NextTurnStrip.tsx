"use client";

import { formatDistance } from "@/lib/format";
import type { Lang, Maneuver, ManeuverIcon } from "@/lib/types";

const ICON_PATHS: Record<ManeuverIcon, string> = {
  left: "M30 40 V22 H14 M20 15 L13 22 L20 29",
  right: "M18 40 V22 H34 M28 15 L35 22 L28 29",
  straight: "M24 40 V10 M17 17 L24 10 L31 17",
  exit: "M18 40 V26 L32 12 M24 12 H32 V20",
  roundabout: "M24 40 V31 M24 31 A7 7 0 1 1 29 19 L34 14 M28 13 H34 V19",
  arrive: "M24 42 C24 42 12 29 12 20 A12 12 0 0 1 36 20 C36 29 24 42 24 42 Z M24 15 A5 5 0 1 0 24.01 15",
};

interface Props {
  maneuver: Maneuver | null;
  progress: number;
  lang: Lang;
}

/** Big arrow, distance to the turn and the instruction, always in the same place (spec 4.2). */
export function NextTurnStrip({ maneuver, progress, lang }: Props) {
  return (
    <div className="turn-strip">
      <svg viewBox="0 0 48 48" className="turn-icon" aria-hidden>
        {maneuver && <path d={ICON_PATHS[maneuver.icon]} />}
      </svg>
      <div className="turn-text">
        <div className="turn-dist">{maneuver ? formatDistance(maneuver.at_m - progress) : ""}</div>
        <div className="turn-instr">{maneuver?.text[lang] ?? ""}</div>
      </div>
    </div>
  );
}
