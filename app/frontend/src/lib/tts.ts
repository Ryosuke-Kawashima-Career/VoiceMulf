/**
 * Host voice output (spec 5.5). Sentences are fetched from /api/tts (Murf Falcon,
 * key stays on the server) and played one by one as soon as each arrives.
 * Audio is cached per language, and navigation phrases are prefetched at route start.
 * If the proxy fails, the browser's speechSynthesis is used instead.
 */
import type { Lang } from "./types";

export type VoiceSource = "murf" | "browser";

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?।]+[.!?।]*\s*/g) ?? [text];
  return parts.map((p) => p.trim()).filter(Boolean);
}

export class HostVoice {
  private ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  private cache = new Map<string, Promise<AudioBuffer | null>>();
  private current: AudioBufferSourceNode | null = null;
  private finishCurrent: (() => void) | null = null;
  private gen = 0;
  /** Fallback-only level, used by the orb when speechSynthesis is speaking. */
  fakeLevel = 0;
  onSource?: (src: VoiceSource, info?: string) => void;
  /** Murf allows few concurrent streams, so requests go through a small queue. */
  private inFlight = 0;
  private waiting: (() => void)[] = [];

  /** Must be called from a user gesture (Start button). */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.connect(this.ctx.destination);
    }
    void this.ctx.resume();
  }

  private slot(urgent: boolean): Promise<void> {
    if (this.inFlight < 2) {
      this.inFlight++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const go = () => {
        this.inFlight++;
        resolve();
      };
      if (urgent) this.waiting.unshift(go);
      else this.waiting.push(go);
    });
  }

  private release() {
    this.inFlight--;
    this.waiting.shift()?.();
  }

  /** Renders and caches audio ahead of time (navigation phrases). */
  prefetch(text: string, lang: Lang) {
    for (const s of splitSentences(text)) void this.fetchAudio(s, lang, false);
  }

  private fetchAudio(text: string, lang: Lang, urgent = true): Promise<AudioBuffer | null> {
    const key = `${lang}|${text}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const p = (async () => {
      await this.slot(urgent);
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, language: lang }),
        });
        if (!res.ok) {
          this.onSource?.("browser", `TTS proxy ${res.status}: ${(await res.text()).slice(0, 160)}`);
          return null;
        }
        const buf = await res.arrayBuffer();
        if (!this.ctx) return null;
        return await this.ctx.decodeAudioData(buf);
      } catch (e) {
        this.onSource?.("browser", `TTS proxy error: ${String(e)}`);
        return null;
      } finally {
        this.release();
      }
    })();
    this.cache.set(key, p);
    // Do not keep failed results, so a later call can retry.
    p.then((b) => {
      if (!b) this.cache.delete(key);
    });
    return p;
  }

  /** Speaks text; resolves when finished or when stop() is called. */
  async say(text: string, lang: Lang): Promise<void> {
    const gen = ++this.gen;
    this.stopPlayback();
    const sentences = splitSentences(text);
    const pending = sentences.map((s) => this.fetchAudio(s, lang));
    for (let i = 0; i < sentences.length; i++) {
      if (gen !== this.gen) return;
      const buf = await pending[i];
      if (gen !== this.gen) return;
      if (buf && this.ctx && this.analyser) {
        this.onSource?.("murf");
        await this.playBuffer(buf, gen);
      } else {
        await this.speakBrowser(sentences[i], lang, gen);
      }
    }
  }

  private playBuffer(buf: AudioBuffer, gen: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.ctx || !this.analyser || gen !== this.gen) return resolve();
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.analyser);
      const finish = () => {
        if (this.current === src) this.current = null;
        if (this.finishCurrent === finish) this.finishCurrent = null;
        resolve();
      };
      src.onended = finish;
      this.current = src;
      this.finishCurrent = finish;
      src.start();
    });
  }

  private speakBrowser(text: string, lang: Lang, gen: number): Promise<void> {
    return new Promise((resolve) => {
      if (typeof speechSynthesis === "undefined" || gen !== this.gen) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      const voice = speechSynthesis.getVoices().find((v) => v.lang === lang);
      if (voice) u.voice = voice;
      const tick = setInterval(() => {
        this.fakeLevel = 0.3 + Math.random() * 0.5;
      }, 90);
      const done = () => {
        clearInterval(tick);
        this.fakeLevel = 0;
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      // Safety net if the browser never fires onend.
      setTimeout(done, 4000 + text.length * 120);
      speechSynthesis.speak(u);
    });
  }

  private stopPlayback() {
    if (this.current) {
      try {
        this.current.onended = null;
        this.current.stop();
      } catch {
        /* already stopped */
      }
      this.current = null;
    }
    const finish = this.finishCurrent;
    this.finishCurrent = null;
    finish?.();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.fakeLevel = 0;
  }

  /** Stops speech immediately. Any pending say() resolves. */
  stop() {
    this.gen++;
    this.stopPlayback();
  }

  /** 0..1 loudness for the orb. */
  level(): number {
    if (this.fakeLevel) return this.fakeLevel;
    if (!this.analyser || !this.current) return 0;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    let sum = 0;
    for (const v of data) sum += v;
    return Math.min(1, sum / data.length / 110);
  }
}
