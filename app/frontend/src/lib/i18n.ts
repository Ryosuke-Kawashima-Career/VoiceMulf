import type { Lang } from "./types";

export interface HostPhrases {
  greet: string;
  offer: string;
  correct: string[];
  wrong: (answer: string) => string;
  noAnswer: (answer: string) => string;
  nextClue: string;
  backToQuestion: string;
  quickFact: string;
  skipping: string;
  closing: string;
  noMore: string;
  /** Early navigation instruction, spoken 800 m before a turn. */
  navAhead: (instruction: string) => string;
}

export const PHRASES: Record<Lang, HostPhrases> = {
  "hi-IN": {
    greet: "नमस्ते! मैं आपकी सफ़र की साथी हूँ।",
    offer: "एक छोटा सा सवाल हो जाए?",
    correct: ["सही जवाब!", "बिल्कुल सही!", "वाह, एकदम सही!"],
    wrong: (a) => `अच्छी कोशिश! जवाब है ${a}।`,
    noAnswer: (a) => `कोई बात नहीं। जवाब है ${a}।`,
    nextClue: "एक और संकेत।",
    backToQuestion: "सवाल पर वापस चलते हैं।",
    quickFact: "एक छोटी सी बात।",
    skipping: "ठीक है, इसे छोड़ते हैं।",
    closing: "खेलने के लिए शुक्रिया! सुरक्षित सफ़र।",
    noMore: "आज के सवाल खत्म हो गए।",
    navAhead: (t) => `800 मीटर बाद, ${t}`,
  },
  "ta-IN": {
    greet: "வணக்கம்! நான் உங்கள் பயணத் தோழி.",
    offer: "ஒரு சின்ன கேள்வி கேட்கலாமா?",
    correct: ["சரியான பதில்!", "மிகச் சரி!", "அருமை, சரி!"],
    wrong: (a) => `நல்ல முயற்சி! பதில் ${a}.`,
    noAnswer: (a) => `பரவாயில்லை. பதில் ${a}.`,
    nextClue: "இன்னொரு குறிப்பு.",
    backToQuestion: "மீண்டும் கேள்விக்கு வருவோம்.",
    quickFact: "ஒரு சின்ன தகவல்.",
    skipping: "சரி, இதை விட்டுவிடலாம்.",
    closing: "விளையாடியதற்கு நன்றி! பாதுகாப்பான பயணம்.",
    noMore: "இன்றைய கேள்விகள் முடிந்துவிட்டன.",
    navAhead: (t) => `800 மீட்டரில், ${t}`,
  },
  "en-IN": {
    greet: "Hi! I'm your co-driver for this trip.",
    offer: "Ready for a quick one?",
    correct: ["Correct!", "Spot on!", "That's right!"],
    wrong: (a) => `Good try! The answer is ${a}.`,
    noAnswer: (a) => `No worries. The answer is ${a}.`,
    nextClue: "Here's another clue.",
    backToQuestion: "Back to the question.",
    quickFact: "A quick fact.",
    skipping: "Okay, let's skip this one.",
    closing: "Thanks for playing! Drive safe.",
    noMore: "That's all the questions for today.",
    navAhead: (t) => `In 800 metres, ${t.charAt(0).toLowerCase()}${t.slice(1)}`,
  },
};
