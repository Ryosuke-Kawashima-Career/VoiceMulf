/**
 * Position replay (spec 5.1 / 6): holds progress_m along the route and advances it.
 * Also maps progress_m to a point on the path for drawing the map.
 */
import type { Route } from "./types";

/** Speed at 1x, in metres per second (90 km/h). */
export const BASE_SPEED_MPS = 25;
export const SPEEDS = [1, 5, 20] as const;
export type Speed = (typeof SPEEDS)[number];

export class Replay {
  progress = 0;
  playing = false;
  speed: Speed = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  /** Called with (previous, current) progress on every move. jumped = moved by the Demo Panel. */
  onMove?: (prev: number, cur: number, jumped: boolean) => void;

  constructor(readonly route: Route) {}

  play() {
    if (this.playing || this.progress >= this.route.length_m) return;
    this.playing = true;
    this.last = performance.now();
    this.timer = setInterval(() => this.tick(), 100);
  }

  pause() {
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setSpeed(s: Speed) {
    this.speed = s;
  }

  /** Moves forward to m as if driven there (triggers fire). Used for GPS fixes. */
  advanceTo(m: number) {
    const prev = this.progress;
    if (m <= prev) return;
    this.progress = Math.min(this.route.length_m, m);
    this.onMove?.(prev, this.progress, false);
  }

  jumpTo(m: number) {
    const prev = this.progress;
    this.progress = Math.max(0, Math.min(this.route.length_m, m));
    this.onMove?.(prev, this.progress, true);
  }

  private tick() {
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    const prev = this.progress;
    this.progress = Math.min(this.route.length_m, prev + BASE_SPEED_MPS * this.speed * dt);
    this.onMove?.(prev, this.progress, false);
    if (this.progress >= this.route.length_m) this.pause();
  }
}

/** Cumulative path lengths, scaled so the last entry equals route.length_m. */
export function pathDistances(route: Route): number[] {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const out = [0];
  for (let i = 1; i < route.path.length; i++) {
    const [la1, lo1] = route.path[i - 1];
    const [la2, lo2] = route.path[i];
    const s =
      Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2;
    out.push(out[i - 1] + 2 * R * Math.asin(Math.sqrt(s)));
  }
  const k = route.length_m / out[out.length - 1];
  return out.map((d) => d * k);
}

/**
 * Snaps a GPS fix to the route (spec 5.1): nearest point on the path between
 * fromM and toM. Returns the distance from the route and the distance along it.
 */
export function snapToRoute(route: Route, dists: number[], lat: number, lon: number, fromM: number, toM: number) {
  const R = 6371000;
  const k = Math.cos((lat * Math.PI) / 180);
  const xy = (p: [number, number]) => [((p[1] * Math.PI) / 180) * k * R, ((p[0] * Math.PI) / 180) * R];
  const [px, py] = xy([lat, lon]);
  let best = { d: Infinity, along: 0 };
  for (let i = 1; i < route.path.length; i++) {
    if (dists[i] < fromM || dists[i - 1] > toM) continue;
    const [ax, ay] = xy(route.path[i - 1]);
    const [bx, by] = xy(route.path[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best.d) best = { d, along: dists[i - 1] + t * (dists[i] - dists[i - 1]) };
  }
  return best;
}

/** [lat, lon] at a given distance along the route. */
export function pointAt(route: Route, dists: number[], m: number): [number, number] {
  const p = route.path;
  if (m <= 0) return p[0];
  for (let i = 1; i < p.length; i++) {
    if (m <= dists[i]) {
      const f = (m - dists[i - 1]) / (dists[i] - dists[i - 1] || 1);
      return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * f, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * f];
    }
  }
  return p[p.length - 1];
}
