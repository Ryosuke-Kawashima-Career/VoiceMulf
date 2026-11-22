/**
 * Voice input (spec 6.2) using the browser's Web Speech API.
 * listen() opens the mic until a final result, a silence timeout, or cancel().
 */
import type { Lang } from "./types";

/* Minimal typings: the Web Speech API is not in TypeScript's DOM lib. */
interface SRAlternative {
  transcript: string;
}
interface SRResult {
  isFinal: boolean;
  0: SRAlternative;
}
interface SREvent {
  resultIndex: number;
  results: { length: number; [i: number]: SRResult };
}
interface SR {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type SRCtor = new () => SR;

function getCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function sttSupported(): boolean {
  return getCtor() !== null;
}

export type ListenResult = { kind: "text"; text: string; typed?: boolean } | { kind: "silence" } | { kind: "cancelled" };

export class Listener {
  private rec: SR | null = null;
  private finish: ((r: ListenResult) => void) | null = null;
  private queuedTyped: string | null = null;
  onInterim?: (text: string) => void;
  onError?: (msg: string) => void;

  get active() {
    return this.finish !== null;
  }

  /** Opens the mic. timeoutMs = silence before giving up (0 = no timeout). */
  listen(lang: Lang, timeoutMs: number): Promise<ListenResult> {
    this.cancel();
    if (this.queuedTyped !== null) {
      const text = this.queuedTyped;
      this.queuedTyped = null;
      return Promise.resolve({ kind: "text", text, typed: true });
    }
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let done = false;
      const end = (r: ListenResult) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        this.finish = null;
        const rec = this.rec;
        this.rec = null;
        if (rec) {
          rec.onend = null;
          rec.onresult = null;
          rec.onerror = null;
          try {
            rec.abort();
          } catch {
            /* ignore */
          }
        }
        resolve(r);
      };
      this.finish = end;
      const arm = () => {
        if (timer) clearTimeout(timer);
        if (timeoutMs > 0) timer = setTimeout(() => end({ kind: "silence" }), timeoutMs);
      };
      arm();

      const Ctor = getCtor();
      if (!Ctor) return; // typed answers and the timeout still work

      let fatal = false;
      const start = () => {
        if (done || fatal) return;
        const rec = new Ctor();
        rec.lang = lang;
        rec.continuous = false;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        rec.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) {
              const text = r[0].transcript.trim();
              if (text) return end({ kind: "text", text });
            } else {
              interim += r[0].transcript;
            }
          }
          if (interim) {
            arm(); // user is talking, do not time out mid-sentence
            this.onInterim?.(interim);
          }
        };
        rec.onerror = (e) => {
          if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "language-not-supported") fatal = true;
          if (e.error !== "no-speech" && e.error !== "aborted") this.onError?.(e.error);
        };
        // Chrome stops after a short silence; keep listening until our own timeout.
        rec.onend = () => {
          if (!done && !fatal) setTimeout(start, 150);
        };
        this.rec = rec;
        try {
          rec.start();
        } catch (err) {
          this.onError?.(String(err));
        }
      };
      start();
    });
  }

  /** Feeds a typed answer (Demo Panel fallback). Queued until the mic opens. */
  inject(text: string) {
    if (this.finish) this.finish({ kind: "text", text, typed: true });
    else this.queuedTyped = text;
  }

  cancel() {
    this.finish?.({ kind: "cancelled" });
  }
}
