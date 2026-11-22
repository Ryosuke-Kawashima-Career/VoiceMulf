export type Lang = "hi-IN" | "ta-IN" | "en-IN";
export type Localized = Record<Lang, string>;

export interface Question {
  id: string;
  type: "landmark" | "region" | "trivia";
  language: Lang;
  prompt: string;
  clues?: string[];
  answers: string[];
  fun_fact: string;
  /** "generated" = written by the Voice AI Agent, not yet fact-checked. */
  source?: "generated";
}

export type ManeuverIcon = "left" | "right" | "exit" | "roundabout" | "straight" | "arrive";

export interface Maneuver {
  at_m: number;
  icon: ManeuverIcon;
  text: Localized;
  /** Replaces the usual "In 800 metres, ..." sentence (used for arrival). */
  text_early?: Localized;
}

export interface Landmark {
  name: Localized;
  at_m: number;
  lat: number;
  lon: number;
  question_id: string;
  /** "osm" = found along the route by the backend; otherwise from places.json. */
  source?: "osm";
}

export interface Region {
  name: Localized;
  enter_at_m: number;
  welcome: Localized;
  greeting: Localized;
  question_id: string;
  source?: "osm";
}

export interface Route {
  route_id: string;
  name: Localized;
  length_m: number;
  /** Routing estimate without traffic. */
  duration_s: number;
  /** GPS start point and the picked destination (the path may start/end on the nearest road). */
  origin: [number, number];
  destination: [number, number];
  path: [number, number][];
  maneuvers: Maneuver[];
  landmarks: Landmark[];
  regions: Region[];
}

export const LANGS: { code: Lang; label: string }[] = [
  { code: "hi-IN", label: "हिंदी" },
  { code: "ta-IN", label: "தமிழ்" },
  { code: "en-IN", label: "English" },
];

/** One Falcon voice per language. Change here to try other voices. */
export const VOICES: Record<Lang, string> = {
  "hi-IN": "en-IN-priya",
  "ta-IN": "en-IN-pooja",
  "en-IN": "en-IN-anisha",
};
