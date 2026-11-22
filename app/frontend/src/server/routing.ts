import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Landmark, Localized, Maneuver, Region, Route } from "@/lib/types";
import { PROJECT_ROOT } from "./env";
import { ARRIVE_EARLY, instruction, iconFor, isSpoken } from "./instructions";
import { drivingRoute } from "./osm";

/** Landmarks this close to the route line are attached to it (spec 3.4). */
const LANDMARK_MAX_DIST_M = 5000;

interface PlaceList {
  landmarks: { id: string; name: Localized; lat: number; lon: number; question_id: string }[];
  regions: {
    id: string;
    name: Localized;
    lat: number;
    lon: number;
    radius_m: number;
    welcome: Localized;
    greeting: Localized;
    question_id: string;
  }[];
}

const R = 6371000;
const rad = (x: number) => (x * Math.PI) / 180;

function haversine(a: [number, number], b: [number, number]): number {
  const s = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Nearest point of the path to p: distance from the path and distance along it. */
function nearestOnPath(p: [number, number], pts: [number, number][], dists: number[]) {
  const k = Math.cos(rad(p[0]));
  const toXY = (q: [number, number]) => [rad(q[1]) * k * R, rad(q[0]) * R];
  const [px, py] = toXY(p);
  let best = { d: Infinity, along: 0 };
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = toXY(pts[i - 1]);
    const [bx, by] = toXY(pts[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best.d) best = { d, along: dists[i - 1] + t * (dists[i] - dists[i - 1]) };
  }
  return best;
}

export async function buildRoute(from: [number, number], to: [number, number], name: string): Promise<Route | null> {
  const osrm = await drivingRoute(from, to);
  if (!osrm) return null;

  // Path from the step geometries, remembering where each step starts.
  const pts: [number, number][] = [];
  const stepStart: number[] = [];
  const steps = osrm.legs.flatMap((l) => l.steps);
  for (const s of steps) {
    const coords = s.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]);
    if (pts.length && coords.length) {
      const last = pts[pts.length - 1];
      if (last[0] === coords[0][0] && last[1] === coords[0][1]) coords.shift();
    }
    stepStart.push(Math.max(0, pts.length - 1));
    pts.push(...coords);
  }
  const dists = [0];
  for (let i = 1; i < pts.length; i++) dists.push(dists[i - 1] + haversine(pts[i - 1], pts[i]));
  const length = Math.round(dists[dists.length - 1]);

  const maneuvers: Maneuver[] = [];
  steps.forEach((s, i) => {
    if (!isSpoken(s)) return;
    const arrive = s.maneuver.type === "arrive";
    maneuvers.push({
      at_m: arrive ? length : Math.round(dists[stepStart[i]]),
      icon: iconFor(s),
      text: instruction(s),
      ...(arrive ? { text_early: ARRIVE_EARLY } : {}),
    });
  });

  const places = JSON.parse(await readFile(path.join(PROJECT_ROOT, "app", "data", "places.json"), "utf8")) as PlaceList;

  const landmarks: Landmark[] = [];
  for (const l of places.landmarks) {
    const near = nearestOnPath([l.lat, l.lon], pts, dists);
    if (near.d <= LANDMARK_MAX_DIST_M) {
      landmarks.push({ name: l.name, at_m: Math.round(near.along), lat: l.lat, lon: l.lon, question_id: l.question_id });
    }
  }

  const regions: Region[] = [];
  for (const g of places.regions) {
    const idx = pts.findIndex((p) => haversine(p, [g.lat, g.lon]) <= g.radius_m);
    if (idx > 0) {
      regions.push({
        name: g.name,
        enter_at_m: Math.round(dists[idx]),
        welcome: g.welcome,
        greeting: g.greeting,
        question_id: g.question_id,
      });
    }
  }

  return {
    route_id: "live",
    name: { "en-IN": name, "hi-IN": name, "ta-IN": name },
    length_m: length,
    duration_s: Math.round(osrm.duration),
    origin: from,
    destination: to,
    path: pts,
    maneuvers,
    landmarks: landmarks.sort((a, b) => a.at_m - b.at_m),
    regions: regions.sort((a, b) => a.enter_at_m - b.enter_at_m),
  };
}
