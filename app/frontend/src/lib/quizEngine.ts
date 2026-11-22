/**
 * Session engine: quiz rounds (spec 2.1), route triggers (5.3) and the
 * "navigation first" speech arbiter (5.2).
 *
 *   Quiz round:  OFFER -> ASK -> LISTEN -> JUDGE -> FEEDBACK -> (next round)
 *   Route items: landmark / region questions skip OFFER and go straight to ASK.
 *   Any phase --pause--> PAUSED --resume--> back to the quiz.
 *
 * Each go(phase) starts a new quiz "token"; async work from an older token stops
 * as soon as it notices. Navigation speech runs outside the quiz flow and can
 * interrupt it at any time.
 */
import { parseCommand, parseYesNo, type Command } from "./commands";
import { PHRASES } from "./i18n";
import { judge } from "./judge";
import { pathDistances, Replay, snapToRoute, type Speed } from "./replay";
import { Listener } from "./stt";
import { HostVoice, type VoiceSource } from "./tts";
import type { Lang, Question, Route } from "./types";

/** Distances and timings (spec 5.2: "distances are settings and may be tuned"). */
export const SETTINGS = {
  navEarlyM: 800,
  navLateM: 100,
  zoneBeforeM: 900,
  zoneAfterM: 100,
  landmarkAheadM: 2000,
  /** Skip the 800 m sentence if the previous maneuver is closer than this. */
  earlyMinGapM: 900,
  /** Direction audio is rendered when the car is this close to a maneuver. */
  prefetchAheadM: 3000,
  /** GPS snapping window and off-route limit. */
  gpsBehindM: 200,
  gpsAheadM: 3000,
  gpsMaxOffRouteM: 100,
  listenMs: 8000,
  nextRoundGapMs: 4000,
};

export type Phase = "IDLE" | "OFFER" | "ASK" | "LISTEN" | "JUDGE" | "FEEDBACK" | "FACT" | "PAUSED" | "ENDED";
export type ItemStatus = "pending" | "asked" | "correct" | "dropped";

export interface DebugEntry {
  at: number;
  kind: "stt" | "typed" | "match" | "command" | "voice" | "played" | "held" | "dropped";
  text: string;
}

export interface Snapshot {
  phase: Phase;
  lang: Lang;
  hostText: string;
  userText: string;
  userInterim: boolean;
  speaking: boolean;
  listening: boolean;
  channel: "directions" | "quiz";
  correct: number;
  asked: number;
  startedAt: number;
  voiceSource: VoiceSource | null;
  debug: DebugEntry[];
  // route
  progress: number;
  playing: boolean;
  speed: Speed;
  zone: boolean;
  nextManeuver: number;
  region: number;
  landmarkStatus: ItemStatus[];
  regionStatus: ItemStatus[];
}

type Kind = "trivia" | "landmark" | "region";
interface Active {
  q: Question;
  kind: Kind;
  ref: number;
  clue: number;
  repeated: boolean;
}
type RouteItem = { kind: "landmark" | "region" | "fact"; idx: number };
type ListenOutcome = { kind: "text"; text: string } | { kind: "silence" } | { kind: "stale" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class QuizEngine {
  readonly voice = new HostVoice();
  readonly route: Route | null;
  private replay: Replay | null = null;
  private listener = new Listener();
  s: Snapshot;
  private token = 0;
  private navToken = 0;
  private navSpeaking = false;
  private resumeAfterNav: Phase | null = null;
  private questions: Question[] = [];
  private usedTrivia = new Set<string>();
  private active: Active | null = null;
  private queue: RouteItem[] = [];
  /** True between a finished round and the next OFFER. */
  private nextRoundDue = false;
  private listeners = new Set<(s: Snapshot) => void>();
  private prefetched = new Set<number>();
  private gpsWatch: number | null = null;
  /** Set once the Demo Panel moves the car; GPS is ignored from then on. */
  private simulated = false;
  private dists: number[] = [];

  constructor(lang: Lang, route: Route | null) {
    this.route = route;
    this.s = {
      phase: "IDLE",
      lang,
      hostText: "",
      userText: "",
      userInterim: false,
      speaking: false,
      listening: false,
      channel: "quiz",
      correct: 0,
      asked: 0,
      startedAt: Date.now(),
      voiceSource: null,
      debug: [],
      progress: 0,
      playing: false,
      speed: 1,
      zone: false,
      nextManeuver: route?.maneuvers.length ? 0 : -1,
      region: -1,
      landmarkStatus: route?.landmarks.map(() => "pending") ?? [],
      regionStatus: route?.regions.map(() => "pending") ?? [],
    };
    this.voice.onSource = (src, info) => {
      if (info) this.log("voice", `${src === "browser" ? "browser voice fallback" : "Murf"}: ${info}`);
      if (src !== this.s.voiceSource) this.set({ voiceSource: src });
    };
    this.listener.onInterim = (text) => this.set({ userText: text, userInterim: true });
    this.listener.onError = (msg) => this.log("stt", `error: ${msg}`);
  }

  // ---------- plumbing ----------

  subscribe(fn: (s: Snapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<Snapshot>) {
    this.s = { ...this.s, ...patch };
    for (const fn of this.listeners) fn(this.s);
  }

  private log(kind: DebugEntry["kind"], text: string) {
    this.set({ debug: [{ at: Date.now(), kind, text }, ...this.s.debug].slice(0, 50) });
  }

  private get P() {
    return PHRASES[this.s.lang];
  }

  private alive(t: number) {
    return t === this.token;
  }

  private findQuestion(id: string): Question | undefined {
    return this.questions.find((q) => q.id === id);
  }

  // ---------- public controls ----------

  /** Call from the Start button click (unlocks audio). */
  async start() {
    this.voice.unlock();
    const t = ++this.token;
    const res = await fetch(`/api/questions?language=${this.s.lang}`);
    this.questions = (await res.json()) as Question[];
    if (this.route) {
      this.replay = new Replay(this.route);
      this.replay.onMove = (prev, cur, jumped) => this.onMove(prev, cur, jumped);
      this.dists = pathDistances(this.route);
      this.prefetchAhead(0);
      this.startGps();
    }
    if (!this.alive(t)) return;
    this.set({ phase: "OFFER", startedAt: Date.now() });
    // Anything already due at the start point (e.g. a turn right after departure) fires now.
    if (this.route) this.onMove(-1e9, 0, false);
    // The greeting is not a quiz, so it only waits for directions, not for the zone.
    if (!(await this.quizSpeak(t, this.P.greet, true))) return;
    this.go("OFFER");
  }

  pauseResume() {
    if (this.s.phase === "PAUSED" || this.s.phase === "IDLE") this.resumeQuiz();
    else if (this.s.phase !== "ENDED") this.go("PAUSED");
  }

  skip() {
    this.handleCommand("skip");
  }

  stop() {
    void this.end();
  }

  /** Typed answer / command from the Demo Panel. */
  typeAnswer(text: string) {
    if (text.trim()) this.listener.inject(text.trim());
  }

  // Demo Panel replay controls (switch the session to a simulated position)
  togglePlay() {
    if (!this.replay) return;
    this.simulated = true;
    if (this.replay.playing) this.replay.pause();
    else this.replay.play();
    this.set({ playing: this.replay.playing });
  }

  setSpeed(speed: Speed) {
    this.replay?.setSpeed(speed);
    this.set({ speed });
  }

  jumpTo(kind: "turn" | "landmark" | "region") {
    const r = this.route;
    if (!r || !this.replay) return;
    const p = this.replay.progress;
    const targets =
      kind === "turn"
        ? r.maneuvers.map((m) => m.at_m - 1000)
        : kind === "landmark"
          ? r.landmarks.map((l) => l.at_m - SETTINGS.landmarkAheadM - 100)
          : r.regions.map((g) => g.enter_at_m - 1000);
    const next = targets.find((m) => m > p + 1);
    if (next !== undefined) {
      this.simulated = true;
      this.replay.jumpTo(next);
    }
  }

  dispose() {
    this.stopGps();
    this.token++;
    this.navToken++;
    this.replay?.pause();
    this.voice.stop();
    this.listener.cancel();
    this.listeners.clear();
  }

  // ---------- route and navigation ----------

  /** Live position from the device GPS, snapped to the route (spec 5.1). */
  private startGps() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    this.gpsWatch = navigator.geolocation.watchPosition(
      (pos) => {
        if (this.simulated || !this.replay || !this.route) return;
        const p = this.replay.progress;
        const snap = snapToRoute(
          this.route,
          this.dists,
          pos.coords.latitude,
          pos.coords.longitude,
          p - SETTINGS.gpsBehindM,
          p + SETTINGS.gpsAheadM,
        );
        if (snap.d <= SETTINGS.gpsMaxOffRouteM) this.replay.advanceTo(snap.along);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 2000 },
    );
  }

  private stopGps() {
    if (this.gpsWatch !== null) navigator.geolocation.clearWatch(this.gpsWatch);
    this.gpsWatch = null;
  }

  /** Renders direction audio for maneuvers coming up within prefetchAheadM. */
  private prefetchAhead(cur: number) {
    this.route?.maneuvers.forEach((m, i) => {
      if (this.prefetched.has(i) || m.at_m < cur || m.at_m - cur > SETTINGS.prefetchAheadM) return;
      this.prefetched.add(i);
      this.voice.prefetch(this.earlyText(i), this.s.lang);
      this.voice.prefetch(m.text[this.s.lang], this.s.lang);
    });
  }

  private earlyText(i: number): string {
    const m = this.route!.maneuvers[i];
    return m.text_early?.[this.s.lang] ?? this.P.navAhead(m.text[this.s.lang]);
  }

  private inZone(p = this.replay?.progress ?? 0): boolean {
    if (!this.route) return false;
    return this.route.maneuvers.some((m) => p >= m.at_m - SETTINGS.zoneBeforeM && p <= m.at_m + SETTINGS.zoneAfterM);
  }

  private onMove(prev: number, cur: number, jumped: boolean) {
    const r = this.route!;
    const crossed = (x: number) => !jumped && prev < x && x <= cur;
    let region = -1;
    r.regions.forEach((g, i) => {
      if (cur >= g.enter_at_m) region = i;
    });
    this.set({
      progress: cur,
      playing: this.replay?.playing ?? false,
      zone: this.inZone(cur),
      nextManeuver: r.maneuvers.findIndex((m) => m.at_m > cur),
      region,
    });

    this.prefetchAhead(cur);
    // Directions: 800 m and 100 m before each turn. If both are crossed in one tick, say only the later one.
    // The 800 m sentence is skipped when the previous maneuver is too close (spec 5.1).
    r.maneuvers.forEach((m, i) => {
      const gap = i === 0 ? Infinity : m.at_m - r.maneuvers[i - 1].at_m;
      if (crossed(m.at_m - SETTINGS.navLateM)) void this.navSay(m.text[this.s.lang]);
      else if (gap >= SETTINGS.earlyMinGapM && crossed(m.at_m - SETTINGS.navEarlyM)) void this.navSay(this.earlyText(i));
    });
    r.landmarks.forEach((l, i) => {
      if (crossed(l.at_m - SETTINGS.landmarkAheadM)) this.onLandmark(i);
    });
    r.regions.forEach((g, i) => {
      if (crossed(g.enter_at_m)) this.onRegion(i);
    });
    if (cur >= r.length_m) this.set({ playing: false });
  }

  private setStatus(kind: "landmark" | "region", i: number, st: ItemStatus) {
    if (kind === "landmark") this.set({ landmarkStatus: this.s.landmarkStatus.map((v, j) => (j === i ? st : v)) });
    else this.set({ regionStatus: this.s.regionStatus.map((v, j) => (j === i ? st : v)) });
  }

  private onLandmark(i: number) {
    const name = this.route!.landmarks[i].name["en-IN"];
    if (this.inZone()) {
      // Rule 3: a landmark question in the directions-first zone is dropped; its fun fact plays after the zone.
      this.log("dropped", `landmark question (${name}): directions first zone`);
      this.setStatus("landmark", i, "dropped");
      this.queue.push({ kind: "fact", idx: i });
    } else {
      this.queue.push({ kind: "landmark", idx: i });
    }
    this.tryQueue();
  }

  private onRegion(i: number) {
    this.queue.push({ kind: "region", idx: i });
    this.tryQueue();
  }

  /** Starts the next route item if no question is active (rule 4: one question at a time). */
  private tryQueue(): boolean {
    const ph = this.s.phase;
    if (this.active || (ph !== "IDLE" && ph !== "OFFER") || !this.queue.length) return false;
    const item = this.queue.shift()!;
    const r = this.route!;
    if (item.kind === "landmark") {
      const lm = r.landmarks[item.idx];
      const q = this.findQuestion(lm.question_id);
      if (!q) return this.tryQueue();
      if (this.s.progress >= lm.at_m) {
        // Passed while another question was running: keep only the fun fact.
        this.log("dropped", `landmark question (${lm.name["en-IN"]}): already passed`);
        this.setStatus("landmark", item.idx, "dropped");
        this.go("FACT", { q });
        return true;
      }
      this.active = { q, kind: "landmark", ref: item.idx, clue: 0, repeated: false };
      this.setStatus("landmark", item.idx, "asked");
    } else if (item.kind === "region") {
      const q = this.findQuestion(r.regions[item.idx].question_id);
      if (!q) return this.tryQueue();
      this.active = { q, kind: "region", ref: item.idx, clue: 0, repeated: false };
      this.setStatus("region", item.idx, "asked");
    } else {
      const q = this.findQuestion(r.landmarks[item.idx].question_id);
      if (!q) return this.tryQueue();
      this.go("FACT", { q });
      return true;
    }
    this.set({ asked: this.s.asked + 1, userText: "" });
    this.go("ASK");
    return true;
  }

  /** Navigation speech: always plays, and interrupts any quiz speech or listening (rule 1). */
  private async navSay(text: string) {
    if (this.s.phase === "ENDED") return;
    const nt = ++this.navToken;
    const quizBusy = (this.s.speaking && this.s.channel === "quiz") || this.s.listening;
    if (quizBusy) {
      if (this.resumeAfterNav === null) this.resumeAfterNav = this.s.phase;
      this.token++; // stops the running quiz step
      this.listener.cancel();
    }
    this.log("played", `directions: ${text}`);
    this.navSpeaking = true;
    this.set({ speaking: true, listening: false, channel: "directions", hostText: text });
    await this.voice.say(text, this.s.lang);
    if (nt !== this.navToken) return; // a newer instruction took over
    this.navSpeaking = false;
    this.set({ speaking: false, channel: "quiz" });
    const phase = this.resumeAfterNav;
    this.resumeAfterNav = null;
    if (phase) this.resumeQuizAfterNav(phase);
  }

  private resumeQuizAfterNav(phase: Phase) {
    if (this.s.phase === "ENDED") return;
    if ((phase === "ASK" || phase === "LISTEN" || phase === "JUDGE") && this.active) {
      if (!this.active.repeated) {
        this.active.repeated = true;
        return this.go("ASK", { back: true });
      }
      this.log("dropped", `question interrupted twice: ${this.active.q.id}`);
      this.active = null;
      return this.endRound();
    }
    if (phase === "FEEDBACK" || phase === "FACT") return this.endRound();
    if (phase === "IDLE") return this.go("IDLE", { nextRound: this.nextRoundDue });
    if (phase === "OFFER" || phase === "PAUSED") return this.go(phase);
  }

  // ---------- speaking and listening ----------

  /** Quiz speech. Held while directions are speaking or in the directions-first zone (rule 2). */
  private async quizSpeak(t: number, text: string, ignoreZone = false): Promise<boolean> {
    if (!this.alive(t)) return false;
    const blocked = () => this.navSpeaking || (!ignoreZone && this.inZone());
    if (blocked()) {
      this.log("held", text);
      while (blocked()) {
        await sleep(200);
        if (!this.alive(t)) return false;
      }
    }
    this.set({ speaking: true, listening: false, channel: "quiz", hostText: text });
    await this.voice.say(text, this.s.lang);
    if (!this.alive(t)) return false;
    this.set({ speaking: false });
    return true;
  }

  /** Opens the mic. Commands are handled here; callers see answers, silence, or "stale". */
  private async listenFor(t: number, ms: number): Promise<ListenOutcome> {
    for (;;) {
      while (this.navSpeaking) {
        await sleep(150);
        if (!this.alive(t)) return { kind: "stale" };
      }
      if (!this.alive(t)) return { kind: "stale" };
      this.set({ listening: true });
      const r = await this.listener.listen(this.s.lang, ms);
      if (!this.alive(t)) return { kind: "stale" };
      this.set({ listening: false });
      if (r.kind === "cancelled") return { kind: "stale" };
      if (r.kind === "silence") return { kind: "silence" };

      this.log(r.typed ? "typed" : "stt", r.text);
      this.set({ userText: r.text, userInterim: false });
      const cmd = parseCommand(r.text, this.s.lang);
      if (cmd) {
        this.log("command", cmd);
        if (this.handleCommand(cmd)) return { kind: "stale" };
        continue;
      }
      if (this.s.phase === "PAUSED") continue; // only commands while paused
      return { kind: "text", text: r.text };
    }
  }

  /** Returns true if the command moved the session to another phase. */
  private handleCommand(cmd: Command): boolean {
    const phase = this.s.phase;
    if (phase === "ENDED") return false;
    switch (cmd) {
      case "pause":
        if (phase === "PAUSED") return false;
        this.go("PAUSED");
        return true;
      case "resume":
        if (phase === "PAUSED" || phase === "IDLE") this.resumeQuiz();
        else if (phase === "OFFER") this.go("ASK", { newTrivia: true });
        else return false;
        return true;
      case "skip":
        if (phase === "PAUSED") return false;
        if (phase === "OFFER") this.go("IDLE");
        else if (this.active) this.go("FEEDBACK", { result: "skip" });
        else return false;
        return true;
      case "repeat":
        if ((phase === "LISTEN" || phase === "ASK") && this.active) this.go("ASK", { repeat: true });
        else if (phase === "OFFER") this.go("OFFER");
        else return false;
        return true;
      case "stop":
        void this.end();
        return true;
    }
  }

  private resumeQuiz() {
    if (this.active) this.go("ASK", { repeat: true });
    else {
      this.go("IDLE");
      if (!this.tryQueue()) this.go("OFFER");
    }
  }

  // ---------- quiz state machine ----------

  private go(phase: Phase, arg: Record<string, unknown> = {}) {
    const t = ++this.token;
    if (!this.navSpeaking) this.voice.stop();
    this.listener.cancel();
    this.set({ phase, listening: false, ...(this.navSpeaking ? {} : { speaking: false }) });
    void this.run(t, phase, arg);
  }

  private endRound() {
    this.active = null;
    this.nextRoundDue = true;
    this.go("IDLE", { nextRound: true });
    this.tryQueue();
  }

  private async run(t: number, phase: Phase, arg: Record<string, unknown>) {
    const P = this.P;
    switch (phase) {
      case "IDLE": {
        if (arg.nextRound) {
          // Next round after a short gap, unless a route item or a command takes over first.
          void sleep(SETTINGS.nextRoundGapMs).then(() => {
            if (this.alive(t) && !this.active) this.go("OFFER");
          });
        }
        const r = await this.listenFor(t, 0);
        if (r.kind === "text" && parseYesNo(r.text, this.s.lang) === "yes") this.go("OFFER");
        else if (r.kind === "text") this.go("IDLE");
        return;
      }

      case "OFFER": {
        this.nextRoundDue = false;
        if (!(await this.quizSpeak(t, P.offer))) return;
        const r = await this.listenFor(t, SETTINGS.listenMs);
        if (r.kind === "stale") return;
        if (r.kind === "text" && parseYesNo(r.text, this.s.lang) === "yes") return this.go("ASK", { newTrivia: true });
        return this.go("IDLE"); // no, unclear or silence: go quiet
      }

      case "ASK": {
        if (arg.newTrivia) {
          const q = this.pickTrivia();
          if (!q) {
            await this.quizSpeak(t, P.noMore);
            if (this.alive(t)) this.go("IDLE");
            return;
          }
          this.active = { q, kind: "trivia", ref: -1, clue: 0, repeated: false };
          this.set({ asked: this.s.asked + 1, userText: "" });
        }
        const a = this.active;
        if (!a) return this.go("IDLE");
        if (!(await this.quizSpeak(t, this.askText(a, arg)))) return;
        return this.go("LISTEN");
      }

      case "LISTEN": {
        const r = await this.listenFor(t, SETTINGS.listenMs);
        if (r.kind === "stale") return;
        return this.go("JUDGE", { text: r.kind === "text" ? r.text : null });
      }

      case "JUDGE": {
        const a = this.active;
        if (!a) return this.go("IDLE");
        const text = arg.text as string | null;
        const res = text ? judge(text, a.q.answers) : null;
        this.log("match", res ? (res.correct ? `correct (${res.how}: "${res.matched}")` : `no match for "${res.normalized}"`) : "no answer");
        if (res?.correct) {
          this.set({ correct: this.s.correct + 1 });
          if (a.kind !== "trivia") this.setStatus(a.kind, a.ref, "correct");
          return this.go("FEEDBACK", { result: "right" });
        }
        // Landmark: next clue (hardest first), until the clues run out.
        if (a.kind === "landmark" && a.clue < (a.q.clues?.length ?? 0)) {
          a.clue++;
          return this.go("ASK");
        }
        return this.go("FEEDBACK", { result: text ? "wrong" : "none" });
      }

      case "FEEDBACK": {
        const a = this.active;
        if (!a) return this.go("IDLE");
        const result = arg.result as "right" | "wrong" | "none" | "skip";
        const answer = a.q.answers[0];
        const line =
          result === "skip"
            ? P.skipping
            : `${
                result === "right"
                  ? P.correct[Math.floor(Math.random() * P.correct.length)]
                  : result === "wrong"
                    ? P.wrong(answer)
                    : P.noAnswer(answer)
              } ${a.q.fun_fact}`;
        if (!(await this.quizSpeak(t, line))) return;
        return this.endRound();
      }

      case "FACT": {
        const q = arg.q as Question;
        if (!(await this.quizSpeak(t, `${P.quickFact} ${q.fun_fact}`))) return;
        return this.endRound();
      }

      case "PAUSED": {
        // Host is silent; mic stays on for commands only.
        await this.listenFor(t, 0);
        return;
      }
    }
  }

  private askText(a: Active, arg: Record<string, unknown>): string {
    const P = this.P;
    const lang = this.s.lang;
    const clues = [a.q.prompt, ...(a.q.clues ?? [])];
    const body = a.kind === "landmark" ? clues[a.clue] : a.q.prompt;
    if (arg.back) return `${P.backToQuestion} ${body}`;
    if (arg.repeat) return body;
    if (a.kind === "landmark" && a.clue > 0) return `${P.nextClue} ${body}`;
    if (a.kind === "region") {
      const g = this.route!.regions[a.ref];
      return `${g.welcome[lang]} ${g.greeting[lang]} ${body}`;
    }
    return body;
  }

  private pickTrivia(): Question | null {
    const pool = this.questions.filter((q) => q.type === "trivia");
    let fresh = pool.filter((q) => !this.usedTrivia.has(q.id));
    if (!fresh.length) {
      this.usedTrivia.clear();
      fresh = pool;
    }
    if (!fresh.length) return null;
    const q = fresh[Math.floor(Math.random() * fresh.length)];
    this.usedTrivia.add(q.id);
    return q;
  }

  private async end() {
    if (this.s.phase === "ENDED") return;
    this.token++;
    this.navToken++;
    this.navSpeaking = false;
    this.stopGps();
    this.replay?.pause();
    this.voice.stop();
    this.listener.cancel();
    this.set({ phase: "ENDED", speaking: true, listening: false, playing: false, channel: "quiz", hostText: this.P.closing });
    await this.voice.say(this.P.closing, this.s.lang);
    this.set({ speaking: false });
  }
}
