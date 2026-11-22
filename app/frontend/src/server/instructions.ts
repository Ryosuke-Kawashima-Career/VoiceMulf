import "server-only";
import type { Lang, Localized, ManeuverIcon } from "@/lib/types";

/** Subset of an OSRM route step that we use. */
export interface OsrmStep {
  name: string;
  ref?: string;
  maneuver: { type: string; modifier?: string; exit?: number };
}

const LANGS: Lang[] = ["hi-IN", "ta-IN", "en-IN"];

/** Steps that need no action from the driver are not spoken (spec 3.5). */
export function isSpoken(s: OsrmStep): boolean {
  const { type, modifier } = s.maneuver;
  if (type === "depart" || type === "new name" || type === "notification") return false;
  if (type === "exit roundabout" || type === "exit rotary") return false;
  if (type === "continue" && (!modifier || modifier === "straight")) return false;
  return true;
}

export function iconFor(s: OsrmStep): ManeuverIcon {
  const { type, modifier = "" } = s.maneuver;
  if (type === "arrive") return "arrive";
  if (type === "roundabout" || type === "rotary" || type === "roundabout turn") return "roundabout";
  if (type === "off ramp") return "exit";
  if (modifier.includes("left") || modifier === "uturn") return "left";
  if (modifier.includes("right")) return "right";
  return "straight";
}

type Dir = "left" | "right" | "slight left" | "slight right" | "sharp left" | "sharp right" | "uturn" | "straight";

const DIR: Record<Lang, Record<Dir, string>> = {
  "en-IN": {
    left: "left",
    right: "right",
    "slight left": "slightly left",
    "slight right": "slightly right",
    "sharp left": "sharp left",
    "sharp right": "sharp right",
    uturn: "around",
    straight: "straight",
  },
  "hi-IN": {
    left: "बाएँ",
    right: "दाएँ",
    "slight left": "थोड़ा बाएँ",
    "slight right": "थोड़ा दाएँ",
    "sharp left": "तेज़ बाएँ",
    "sharp right": "तेज़ दाएँ",
    uturn: "वापस",
    straight: "सीधे",
  },
  "ta-IN": {
    left: "இடது",
    right: "வலது",
    "slight left": "சற்று இடது",
    "slight right": "சற்று வலது",
    "sharp left": "கூர்மையாக இடது",
    "sharp right": "கூர்மையாக வலது",
    uturn: "திரும்பி",
    straight: "நேராக",
  },
};

const ORDINAL: Record<Lang, string[]> = {
  "en-IN": ["first", "second", "third", "fourth", "fifth", "sixth"],
  "hi-IN": ["पहला", "दूसरा", "तीसरा", "चौथा", "पाँचवाँ", "छठा"],
  "ta-IN": ["முதல்", "இரண்டாவது", "மூன்றாவது", "நான்காவது", "ஐந்தாவது", "ஆறாவது"],
};

/** "Keep left/right" side for forks and ramps. */
const SIDE: Record<Lang, { left: string; right: string }> = {
  "en-IN": { left: "left", right: "right" },
  "hi-IN": { left: "बाईं ओर", right: "दाईं ओर" },
  "ta-IN": { left: "இடது பக்கமாக", right: "வலது பக்கமாக" },
};

function road(s: OsrmStep): string {
  return (s.name || s.ref || "").trim();
}

function sentence(lang: Lang, s: OsrmStep): string {
  const { type, modifier = "straight", exit } = s.maneuver;
  const dir = (modifier in DIR[lang] ? modifier : "straight") as Dir;
  const d = DIR[lang][dir];
  const side = SIDE[lang][dir.includes("left") ? "left" : "right"];
  const r = road(s);
  const nth = ORDINAL[lang][Math.min(Math.max((exit ?? 1) - 1, 0), 5)];

  if (lang === "en-IN") {
    const onto = r ? ` onto ${r}` : "";
    switch (type) {
      case "arrive":
        return "You have arrived at your destination.";
      case "roundabout":
      case "rotary":
      case "roundabout turn":
        return `At the roundabout, take the ${nth} exit${onto}.`;
      case "fork":
        return `Keep ${side}${onto}.`;
      case "merge":
        return `Merge${onto || " ahead"}.`;
      case "on ramp":
        return `Take the ramp${onto}.`;
      case "off ramp":
        return `Take the exit${r ? ` towards ${r}` : ""}.`;
      case "end of road":
        return `At the end of the road, turn ${d}${onto}.`;
      default:
        return dir === "uturn" ? "Make a U-turn." : dir === "straight" ? `Continue straight${onto}.` : `Turn ${d}${onto}.`;
    }
  }

  if (lang === "hi-IN") {
    const on = r ? `${r} पर ` : "";
    switch (type) {
      case "arrive":
        return "आप अपनी मंज़िल पर पहुँच गए हैं।";
      case "roundabout":
      case "rotary":
      case "roundabout turn":
        return `गोल चक्कर पर ${nth} एग्ज़िट लीजिए।`;
      case "fork":
        return `${side} रहिए${r ? `, ${r} की ओर` : ""}।`;
      case "merge":
        return `${on}आगे मिल जाइए।`;
      case "on ramp":
        return `${r ? `${r} के लिए ` : ""}रैंप लीजिए।`;
      case "off ramp":
        return `${r ? `${r} की ओर ` : ""}एग्ज़िट लीजिए।`;
      case "end of road":
        return `सड़क के अंत में ${d} मुड़िए।`;
      default:
        return dir === "uturn" ? "यू-टर्न लीजिए।" : dir === "straight" ? `${on}सीधे चलते रहिए।` : `${on}${d} मुड़िए।`;
    }
  }

  // ta-IN
  const towards = r ? `, ${r} நோக்கி` : "";
  switch (type) {
    case "arrive":
      return "நீங்கள் சேருமிடத்தை அடைந்துவிட்டீர்கள்.";
    case "roundabout":
    case "rotary":
    case "roundabout turn":
      return `சுற்றுவட்டத்தில் ${nth} வெளியேற்றத்தில் செல்லுங்கள்.`;
    case "fork":
      return `${side} செல்லுங்கள்${towards}.`;
    case "merge":
      return `சாலையில் இணையுங்கள்${towards}.`;
    case "on ramp":
      return `சாய்வுப் பாதையில் செல்லுங்கள்${towards}.`;
    case "off ramp":
      return `வெளியேறுங்கள்${towards}.`;
    case "end of road":
      return `சாலையின் முடிவில் ${d} பக்கம் திரும்புங்கள்.`;
    default:
      return dir === "uturn" ? "யு-டர்ன் செய்யுங்கள்." : dir === "straight" ? `நேராகச் செல்லுங்கள்${towards}.` : `${d} பக்கம் திரும்புங்கள்${towards}.`;
  }
}

export function instruction(s: OsrmStep): Localized {
  return Object.fromEntries(LANGS.map((l) => [l, sentence(l, s)])) as Localized;
}

/** Replaces the 800 m sentence for the arrival step. */
export const ARRIVE_EARLY: Localized = {
  "en-IN": "Your destination is 800 metres ahead.",
  "hi-IN": "आपकी मंज़िल 800 मीटर आगे है।",
  "ta-IN": "உங்கள் சேருமிடம் 800 மீட்டர் தொலைவில் உள்ளது.",
};
