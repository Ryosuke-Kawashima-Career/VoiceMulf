import "server-only";

/**
 * Calls to the public OpenStreetMap services (spec 5.6), made from the server so the
 * app identifies itself and results can be cached. Nominatim allows at most 1 request/s.
 */
const USER_AGENT = "VoiceQuizCoDriver-hackathon-demo/0.1";
const NOMINATIM = "https://nominatim.openstreetmap.org";
const OSRM = "https://router.project-osrm.org";

const cache = new Map<string, unknown>();
let lastNominatim = 0;

async function getJson<T>(url: string, throttle: boolean): Promise<T> {
  const hit = cache.get(url);
  if (hit) return hit as T;
  if (throttle) {
    const wait = lastNominatim + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatim = Date.now();
  }
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  const data = (await res.json()) as T;
  if (cache.size > 200) cache.clear();
  cache.set(url, data);
  return data;
}

export interface Place {
  name: string;
  detail: string;
  lat: number;
  lon: number;
}

interface NominatimResult {
  name: string;
  display_name: string;
  lat: string;
  lon: string;
}

/** Destination search, biased (not limited) to the area around the user. */
export async function searchPlaces(q: string, near: { lat: number; lon: number } | null): Promise<Place[]> {
  const params = new URLSearchParams({ q, format: "jsonv2", limit: "5" });
  if (near) {
    const d = 1.5; // ~150 km box used only as a preference
    params.set("viewbox", `${near.lon - d},${near.lat + d},${near.lon + d},${near.lat - d}`);
  }
  const rows = await getJson<NominatimResult[]>(`${NOMINATIM}/search?${params}`, true);
  const places = rows.map((r) => {
    const parts = r.display_name.split(", ");
    return {
      name: r.name || parts[0],
      detail: parts.slice(1, 4).join(", "),
      lat: Number(r.lat),
      lon: Number(r.lon),
    };
  });
  if (near) {
    const dist = (p: Place) => (p.lat - near.lat) ** 2 + ((p.lon - near.lon) * Math.cos((near.lat * Math.PI) / 180)) ** 2;
    places.sort((a, b) => dist(a) - dist(b));
  }
  return places;
}

export interface OsrmRoute {
  distance: number;
  duration: number;
  legs: {
    steps: {
      name: string;
      ref?: string;
      distance: number;
      geometry: { coordinates: [number, number][] };
      maneuver: { type: string; modifier?: string; exit?: number; location: [number, number] };
    }[];
  }[];
}

export async function drivingRoute(from: [number, number], to: [number, number]): Promise<OsrmRoute | null> {
  const coords = `${from[1]},${from[0]};${to[1]},${to[0]}`;
  const data = await getJson<{ code: string; routes?: OsrmRoute[] }>(
    `${OSRM}/route/v1/driving/${coords}?overview=false&steps=true&geometries=geojson`,
    false,
  );
  return data.code === "Ok" && data.routes?.length ? data.routes[0] : null;
}
