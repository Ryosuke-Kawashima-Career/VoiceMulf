import { buildRoute } from "@/server/routing";

function parsePoint(v: string | null): [number, number] | null {
  const m = v?.split(",").map(Number);
  if (!m || m.length !== 2 || m.some((x) => !Number.isFinite(x))) return null;
  if (Math.abs(m[0]) > 90 || Math.abs(m[1]) > 180) return null;
  return [m[0], m[1]];
}

/** GET /api/route?from=lat,lon&to=lat,lon&name=... -> Route (spec 3.5) */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = parsePoint(url.searchParams.get("from"));
  const to = parsePoint(url.searchParams.get("to"));
  const name = (url.searchParams.get("name") ?? "").slice(0, 120);
  if (!from || !to) return new Response("from and to are required as lat,lon", { status: 400 });
  try {
    const route = await buildRoute(from, to, name);
    if (!route) return new Response("No driving route found", { status: 404 });
    return Response.json(route);
  } catch (e) {
    return new Response(`Routing failed: ${String(e)}`, { status: 502 });
  }
}
