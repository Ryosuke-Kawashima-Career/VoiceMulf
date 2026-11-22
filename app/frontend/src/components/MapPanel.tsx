"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatClock, formatDistance, formatDuration } from "@/lib/format";
import { pathDistances, pointAt } from "@/lib/replay";
import type { Lang, Route } from "@/lib/types";

interface Props {
  route: Route;
  lang: Lang;
  /** preview: whole route with start and destination (Home). drive: live map with the car. */
  variant: "preview" | "drive";
  progress?: number;
  nextManeuver?: number;
  zone?: boolean;
}

interface Layers {
  L: typeof Leaflet;
  map: Leaflet.Map;
  done?: Leaflet.Polyline;
  car?: Leaflet.CircleMarker;
  turn?: Leaflet.CircleMarker;
}

const FOLLOW_ZOOM = 15;
const START_OVERVIEW_MS = 4000;
/** Fit padding; the drive map keeps room for the chip/button on top and the trip card at the bottom. */
const fitOptions = (drive: boolean): Leaflet.FitBoundsOptions =>
  drive ? { paddingTopLeft: [30, 60], paddingBottomRight: [30, 100], animate: false } : { padding: [36, 36] };

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Real street map (OpenStreetMap tiles via Leaflet), spec 4.1 route preview and 4.2 map panel. */
export function MapPanel({ route, lang, variant, progress = 0, nextManeuver = -1, zone = false }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const layers = useRef<Layers | null>(null);
  const [ready, setReady] = useState(false);
  const [overview, setOverview] = useState(variant === "drive");
  const dists = useMemo(() => pathDistances(route), [route]);
  const now = useNow(30_000);
  const drive = variant === "drive";

  // Build the map once per route.
  useEffect(() => {
    let cancelled = false;
    let map: Leaflet.Map | null = null;
    void import("leaflet").then(({ default: L }) => {
      if (cancelled || !el.current) return;
      map = L.map(el.current, {
        zoomControl: false,
        dragging: false,
        scrollWheelZoom: false,
        touchZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      L.polyline(route.path, { color: drive ? "#9aa6b8" : "#2b6fc0", weight: 6, opacity: 0.95 }).addTo(map);
      for (const l of route.landmarks) {
        const pin = L.circleMarker([l.lat, l.lon], { radius: 6, color: "#ffffff", weight: 2, fillColor: "#1f8a64", fillOpacity: 1 });
        if (drive) pin.bindTooltip(l.name[lang], { permanent: true, direction: "right", className: "map-tip" });
        pin.addTo(map);
      }
      L.marker(route.destination, {
        icon: L.divIcon({ className: "dest-pin", html: "<span></span>", iconSize: [28, 36], iconAnchor: [14, 36] }),
        keyboard: false,
        interactive: false,
      }).addTo(map);

      const ly: Layers = { L, map };
      if (drive) {
        ly.done = L.polyline([], { color: "#2b6fc0", weight: 6 }).addTo(map);
        ly.turn = L.circleMarker(route.path[0], { radius: 10, color: "#c77c00", weight: 3, fill: false }).addTo(map);
        ly.car = L.circleMarker(route.path[0], { radius: 8, color: "#2b6fc0", weight: 4, fillColor: "#ffffff", fillOpacity: 1 }).addTo(map);
      } else {
        L.circleMarker(route.origin, { radius: 8, color: "#ffffff", weight: 3, fillColor: "#2b6fc0", fillOpacity: 1 }).addTo(map);
      }
      map.fitBounds(L.latLngBounds([...route.path, route.origin, route.destination]), fitOptions(drive));
      layers.current = ly;
      setReady(true);
    });
    return () => {
      cancelled = true;
      layers.current = null;
      setReady(false);
      map?.remove();
    };
  }, [route, lang, drive]);

  // The drive starts in overview, then follows the car (spec 4.2).
  useEffect(() => {
    if (!drive) return;
    const id = setTimeout(() => setOverview(false), START_OVERVIEW_MS);
    return () => clearTimeout(id);
  }, [drive, route]);

  // Move the car, the driven part and the next-turn ring; keep the right view.
  useEffect(() => {
    const ly = layers.current;
    if (!ready || !ly || !drive || !ly.car || !ly.done || !ly.turn) return;
    const car = pointAt(route, dists, progress);
    ly.car.setLatLng(car);
    ly.done.setLatLngs([...route.path.filter((_, i) => dists[i] < progress), car]);
    if (nextManeuver >= 0) {
      ly.turn.setLatLng(pointAt(route, dists, route.maneuvers[nextManeuver].at_m));
      ly.turn.setStyle({ opacity: 1 });
    } else {
      ly.turn.setStyle({ opacity: 0 });
    }
    if (overview) {
      const rest = route.path.filter((_, i) => dists[i] >= progress);
      ly.map.fitBounds(ly.L.latLngBounds([car, ...rest, route.destination]), fitOptions(true));
    } else {
      ly.map.setView(car, Math.max(ly.map.getZoom(), FOLLOW_ZOOM), { animate: false });
    }
  }, [ready, drive, route, dists, progress, nextManeuver, overview]);

  const remaining = Math.max(0, route.length_m - progress);
  const remainingSec = route.length_m ? (route.duration_s * remaining) / route.length_m : 0;

  return (
    <div className={`map-panel ${drive ? "" : "preview"}`}>
      <div ref={el} className="map-canvas" aria-label="Route map" />
      {drive && zone && <span className="zone-chip">Directions first</span>}
      {drive && (
        <>
          <button className="map-btn" onClick={() => setOverview((o) => !o)}>
            {overview ? "Re-centre" : "Overview"}
          </button>
          <div className="trip-card">
            <span className="trip-dest">{route.name[lang]}</span>
            <span>
              {formatDistance(remaining)} · {formatDuration(remainingSec)} · arrive {formatClock(now + remainingSec * 1000)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
