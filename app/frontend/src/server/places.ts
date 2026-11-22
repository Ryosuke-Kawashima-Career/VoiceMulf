import "server-only";
import type { Landmark, Localized, Region } from "@/lib/types";
import { reverseGeocode } from "./osm";
import { haversine, nearestOnPath } from "./routing";

/**
 * Places along the route from OpenStreetMap (backend spec 3.2). Towns become landmarks,
 * cities and newly entered states become regions. Runs in the background quiz call.
 *
 * Source 1: one Overpass query for city/town nodes near the route (best results, but the
 * public servers are often overloaded). Source 2 (fallback): Nominatim reverse lookups
 * sampled along the route.
 */
const OVERPASS = "https://overpass-api.de/api/interpreter";
const OVERPASS_TIMEOUT_MS = 15000;
const USER_AGENT = "VoiceQuizCoDriver-hackathon-demo/0.1";
const NEAR_ROUTE_M = 3000;
const REGION_RADIUS_M = 5000;
const CURATED_OVERLAP_M = 5000;
const MAX_PLACES = 8;
const SAMPLE_EVERY_M = 12000;
const MAX_SAMPLES = 15;

export interface CuratedPlace {
  lat: number;
  lon: number;
  name: string;
}

export interface FoundPlaces {
  landmarks: Landmark[];
  regions: Region[];
  source: "overpass" | "nominatim" | "none";
  error: string | null;
}

interface Candidate {
  id: string;
  name: Localized;
  kind: "landmark" | "region";
  lat: number;
  lon: number;
  /** Distance along the route (landmarks) or where the region is entered. */
  at: number;
}

function localized(tags: Record<string, string>, fallback?: string): Localized | null {
  const clean = (s: string) => s.replace(/\s+(taluk|taluka|tehsil|mandal|district|city corporation)$/i, "").trim();
  const en = tags["name:en"] || tags.name || fallback;
  if (!en) return null;
  return {
    "en-IN": clean(en),
    "hi-IN": clean(tags["name:hi"] || en),
    "ta-IN": clean(tags["name:ta"] || en),
  };
}

function defaultWelcome(n: Localized): Localized {
  return {
    "en-IN": `Welcome to ${n["en-IN"]}.`,
    "hi-IN": `${n["hi-IN"]} में आपका स्वागत है।`,
    "ta-IN": `${n["ta-IN"]} உங்களை வரவேற்கிறது.`,
  };
}

function cumulative(path: [number, number][]): number[] {
  const d = [0];
  for (let i = 1; i < path.length; i++) d.push(d[i - 1] + haversine(path[i - 1], path[i]));
  return d;
}

/** Where the route first comes within REGION_RADIUS_M of a city centre (-1 if it starts inside). */
function enterAt(path: [number, number][], dists: number[], lat: number, lon: number): number {
  const idx = path.findIndex((p) => haversine(p, [lat, lon]) <= REGION_RADIUS_M);
  return idx <= 0 ? -1 : dists[idx];
}

async function viaOverpass(path: [number, number][], dists: number[]): Promise<Candidate[]> {
  const lats = path.map((p) => p[0]);
  const lons = path.map((p) => p[1]);
  const pad = 0.03;
  const bbox = [Math.min(...lats) - pad, Math.min(...lons) - pad, Math.max(...lats) + pad, Math.max(...lons) + pad]
    .map((x) => x.toFixed(4))
    .join(",");
  const query = `[out:json][timeout:15];node[place~"^(city|town)$"](${bbox});out body;`;
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const nodes = ((await res.json()) as { elements: { id: number; lat: number; lon: number; tags?: Record<string, string> }[] })
    .elements;
  const out: Candidate[] = [];
  for (const n of nodes) {
    const name = localized(n.tags ?? {});
    if (!name) continue;
    const near = nearestOnPath([n.lat, n.lon], path, dists);
    if (near.d > NEAR_ROUTE_M) continue;
    const city = n.tags?.place === "city";
    const at = city ? enterAt(path, dists, n.lat, n.lon) : near.along;
    if (at < 0) continue;
    out.push({ id: `osm_node_${n.id}`, name, kind: city ? "region" : "landmark", lat: n.lat, lon: n.lon, at });
  }
  return out;
}

async function viaNominatim(path: [number, number][], dists: number[]): Promise<Candidate[]> {
  const length = dists[dists.length - 1];
  const every = Math.max(SAMPLE_EVERY_M, length / MAX_SAMPLES);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  let state: string | null = null;
  let i = 0;
  for (let m = 0; m <= length; m += every) {
    while (i < dists.length - 1 && dists[i] < m) i++;
    const p = path[i];
    const r = await reverseGeocode(p[0], p[1]).catch(() => null);
    if (!r) continue;
    // State crossing -> region (not the state the trip starts in).
    const st = r.address?.state;
    if (st && state && st !== state && !seen.has(`state_${st}`)) {
      seen.add(`state_${st}`);
      const name = localized({}, st)!;
      out.push({ id: `state_${st.toLowerCase().replace(/\W+/g, "_")}`, name, kind: "region", lat: p[0], lon: p[1], at: dists[i] });
    }
    state = st ?? state;
    if (m === 0) continue; // the start area is not a place we "pass"
    const type = r.addresstype;
    if (type !== "city" && type !== "town" && type !== "county") continue;
    const id = `osm_${r.osm_type}_${r.osm_id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const name = localized(r.namedetails ?? {}, r.name);
    if (!name) continue;
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (type === "city") {
      const at = enterAt(path, dists, lat, lon);
      if (at >= 0) out.push({ id, name, kind: "region", lat, lon, at });
    } else {
      out.push({ id, name, kind: "landmark", lat, lon, at: nearestOnPath([lat, lon], path, dists).along });
    }
  }
  return out;
}

export async function findPlacesAlongRoute(path: [number, number][], curated: CuratedPlace[]): Promise<FoundPlaces> {
  const dists = cumulative(path);
  let candidates: Candidate[] = [];
  let source: FoundPlaces["source"] = "none";
  const errors: string[] = [];
  try {
    candidates = await viaOverpass(path, dists);
    source = "overpass";
  } catch (e) {
    errors.push(String(e));
    try {
      candidates = await viaNominatim(path, dists);
      source = "nominatim";
    } catch (e2) {
      errors.push(String(e2));
    }
  }

  // Curated places.json items win: drop candidates close to one or with the same name.
  const firstWord = (s: string) => s.toLowerCase().split(/[\s,]+/)[0];
  const curatedNames = new Set(curated.map((c) => firstWord(c.name)));
  candidates = candidates.filter(
    (c) =>
      !curated.some((k) => haversine([k.lat, k.lon], [c.lat, c.lon]) <= CURATED_OVERLAP_M) &&
      !curatedNames.has(firstWord(c.name["en-IN"])),
  );

  // Keep at most MAX_PLACES, spread along the route.
  candidates.sort((a, b) => a.at - b.at);
  const step = candidates.length / MAX_PLACES;
  const picked =
    candidates.length <= MAX_PLACES ? candidates : Array.from({ length: MAX_PLACES }, (_, k) => candidates[Math.floor(k * step)]);

  const landmarks: Landmark[] = [];
  const regions: Region[] = [];
  for (const c of picked) {
    if (c.kind === "region") {
      regions.push({
        name: c.name,
        enter_at_m: Math.round(c.at),
        welcome: defaultWelcome(c.name),
        greeting: { "en-IN": "", "hi-IN": "", "ta-IN": "" },
        question_id: c.id,
        source: "osm",
      });
    } else {
      landmarks.push({ name: c.name, at_m: Math.round(c.at), lat: c.lat, lon: c.lon, question_id: c.id, source: "osm" });
    }
  }
  return { landmarks, regions, source, error: errors.length ? errors.join("; ") : null };
}
