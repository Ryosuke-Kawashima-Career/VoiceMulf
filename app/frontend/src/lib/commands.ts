/** Voice commands (spec 2): skip, repeat, pause, resume, stop. Matched in the chosen language and in English. */
import { normalize } from "./judge";
import type { Lang } from "./types";

export type Command = "pause" | "resume" | "skip" | "repeat" | "stop";

const WORDS: Record<Lang | "en", Record<Command, string[]>> = {
  en: {
    pause: ["pause", "hold on", "wait"],
    resume: ["resume", "continue", "start again"],
    skip: ["skip", "pass", "next question"],
    repeat: ["repeat", "say again", "again", "come again"],
    stop: ["stop", "quit", "end game", "enough"],
  },
  "en-IN": { pause: [], resume: [], skip: [], repeat: [], stop: [] },
  "hi-IN": {
    pause: ["रुको", "रुकिए", "रुक जाओ", "ठहरो", "पॉज़", "पॉज"],
    resume: ["शुरू", "शुरू करो", "फिर से शुरू", "आगे"],
    skip: ["छोड़ो", "छोड़ दो", "अगला", "अगला सवाल", "स्किप"],
    repeat: ["फिर से", "दोबारा", "फिर से बोलो", "रिपीट"],
    stop: ["बंद करो", "बंद", "बस", "खत्म", "स्टॉप"],
  },
  "ta-IN": {
    pause: ["நிறுத்து", "நில்லு", "கொஞ்சம் இரு"],
    resume: ["தொடர்", "தொடரு", "தொடங்கு", "ஆரம்பி"],
    skip: ["அடுத்தது", "அடுத்த கேள்வி", "விடு", "ஸ்கிப்"],
    repeat: ["மறுபடி", "திரும்ப சொல்லு", "மீண்டும்"],
    stop: ["முடி", "போதும்", "முடிச்சுக்கலாம்"],
  },
};

const YES: Record<Lang | "en", string[]> = {
  en: ["yes", "yeah", "yep", "sure", "ok", "okay", "go", "ready", "go ahead", "of course"],
  "en-IN": [],
  "hi-IN": ["हाँ", "हां", "हा", "जी", "जी हाँ", "ठीक है", "चलो", "बिल्कुल", "हाँ जी"],
  "ta-IN": ["ஆமா", "ஆம்", "சரி", "ஓகே", "கேளுங்க", "ரெடி"],
};
const NO: Record<Lang | "en", string[]> = {
  en: ["no", "nope", "not now", "later", "nah"],
  "en-IN": [],
  "hi-IN": ["नहीं", "नही", "अभी नहीं", "ना"],
  "ta-IN": ["வேண்டாம்", "இல்லை", "இல்ல", "அப்புறம்"],
};

function has(said: string, phrase: string): boolean {
  const p = normalize(phrase);
  return p.length > 0 && ` ${said} `.includes(` ${p} `);
}

/** Returns a command if the utterance is a short command, otherwise null. */
export function parseCommand(text: string, lang: Lang): Command | null {
  const said = normalize(text);
  if (!said || said.split(" ").length > 5) return null;
  const order: Command[] = ["stop", "pause", "resume", "skip", "repeat"];
  for (const c of order) {
    if ([...WORDS[lang][c], ...WORDS.en[c]].some((w) => has(said, w))) return c;
  }
  return null;
}

export function parseYesNo(text: string, lang: Lang): "yes" | "no" | null {
  const said = normalize(text);
  if (!said) return null;
  if ([...NO[lang], ...NO.en].some((w) => has(said, w))) return "no";
  if ([...YES[lang], ...YES.en].some((w) => has(said, w))) return "yes";
  return null;
}
