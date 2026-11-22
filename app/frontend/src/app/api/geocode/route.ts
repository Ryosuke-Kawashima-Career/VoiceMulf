import { searchPlaces } from "@/server/osm";

/** GET /api/geocode?q=...&near=lat,lon -> up to 5 places, nearest first (spec 4.1 / 5.6) */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
  if (q.length < 2) return Response.json([]);
  const near = url.searchParams.get("near")?.split(",").map(Number);
  const nearPt = near && near.length === 2 && near.every(Number.isFinite) ? { lat: near[0], lon: near[1] } : null;
  try {
    return Response.json(await searchPlaces(q, nearPt));
  } catch (e) {
    return new Response(`Search failed: ${String(e)}`, { status: 502 });
  }
}
