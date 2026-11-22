"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatDistance, formatDuration } from "@/lib/format";
import { sttSupported } from "@/lib/stt";
import { LANGS, type Lang, type Route } from "@/lib/types";
import { MapPanel } from "./MapPanel";

export interface Place {
  name: string;
  detail: string;
  lat: number;
  lon: number;
}

export interface HomeChoice {
  lang: Lang;
  route: Route | null;
}

interface Props {
  initialLang: Lang;
  onStart: (choice: HomeChoice) => void;
}

type Preview = { state: "loading" } | { state: "ready"; route: Route } | { state: "error"; message: string };

type Gps = { state: "locating" } | { state: "found"; lat: number; lon: number; acc: number } | { state: "failed" };

export function HomeScreen({ initialLang, onStart }: Props) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [quizOnly, setQuizOnly] = useState(false);
  const [gps, setGps] = useState<Gps>({ state: "locating" });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dest, setDest] = useState<Place | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const previewReq = useRef(0);
  const [micState, setMicState] = useState<"unknown" | "checking" | "denied">("unknown");
  const noStt = useSyncExternalStore(
    () => () => {},
    () => !sttSupported(),
    () => false,
  );

  const locate = useCallback(() => {
    if (!navigator.geolocation) return setGps({ state: "failed" });
    setGps({ state: "locating" });
    navigator.geolocation.getCurrentPosition(
      (p) => setGps({ state: "found", lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      () => setGps({ state: "failed" }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }, []);

  useEffect(() => {
    const id = setTimeout(locate, 0);
    return () => clearTimeout(id);
  }, [locate]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setSearchError(null);
    setDest(null);
    setPreview(null);
    previewReq.current++;
    try {
      const near = gps.state === "found" ? `&near=${gps.lat},${gps.lon}` : "";
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query.trim())}${near}`);
      if (!res.ok) throw new Error();
      setResults((await res.json()) as Place[]);
    } catch {
      setResults(null);
      setSearchError("Search is not available right now. Please try again.");
    } finally {
      setSearching(false);
    }
  }

  /** Route preview: calculated as soon as a destination is picked (spec 4.1). */
  async function pick(p: Place) {
    if (gps.state !== "found") return;
    const id = ++previewReq.current;
    setDest(p);
    setPreview({ state: "loading" });
    try {
      const q = new URLSearchParams({ from: `${gps.lat},${gps.lon}`, to: `${p.lat},${p.lon}`, name: p.name });
      const res = await fetch(`/api/route?${q}`);
      if (res.status === 404) throw new Error("No driving route was found to this destination.");
      if (!res.ok) throw new Error("The route could not be planned right now. Please try again.");
      const route = (await res.json()) as Route;
      if (id === previewReq.current) setPreview({ state: "ready", route });
    } catch (e) {
      if (id === previewReq.current) setPreview({ state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function start() {
    setMicState("checking");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      setMicState("denied");
      return;
    }
    setMicState("unknown");
    onStart({ lang, route: quizOnly || preview?.state !== "ready" ? null : preview.route });
  }

  const canStart = quizOnly || preview?.state === "ready";

  return (
    <main className="screen home">
      <div className="brand">
        <h1>Quiz Co-Driver</h1>
        <p>Turn-by-turn directions and voice quizzes for the road, in your language.</p>
      </div>

      <div>
        <div className="field-label">Language</div>
        <div className="segmented">
          {LANGS.map((l) => (
            <button key={l.code} aria-pressed={lang === l.code} onClick={() => setLang(l.code)}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="field-label">Trip</div>
        <div className="segmented">
          <button aria-pressed={!quizOnly} onClick={() => setQuizOnly(false)}>
            Drive to a destination
          </button>
          <button aria-pressed={quizOnly} onClick={() => setQuizOnly(true)}>
            No route (quiz only)
          </button>
        </div>
      </div>

      {!quizOnly && (
        <>
          <div className="notice">
            <span>
              {gps.state === "locating" && "Locating…"}
              {gps.state === "found" && `Current location found (±${Math.round(gps.acc)} m)`}
              {gps.state === "failed" && "Location access is needed to plan the route."}
            </span>
            {gps.state === "failed" && (
              <button className="small-btn" onClick={locate}>
                Retry
              </button>
            )}
          </div>

          <div>
            <div className="field-label">Destination</div>
            <form className="search-row" onSubmit={search}>
              <input
                className="text-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a place or address"
                enterKeyHint="search"
              />
              <button className="small-btn search-btn" type="submit" disabled={searching}>
                Search
              </button>
            </form>
            {searchError && <div className="hint">{searchError}</div>}
            {results && results.length === 0 && <div className="hint">No places found.</div>}
            {results && results.length > 0 && (
              <ul className="results">
                {results.map((p, i) => (
                  <li key={`${p.lat},${p.lon},${i}`}>
                    <button aria-pressed={dest === p} onClick={() => void pick(p)} disabled={gps.state !== "found"}>
                      <span className="r-name">{p.name}</span>
                      <span className="r-detail">{p.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {preview?.state === "loading" && <div className="hint">Planning route…</div>}
          {preview?.state === "error" && (
            <div className="notice" role="alert">
              <span>{preview.message}</span>
            </div>
          )}
          {preview?.state === "ready" && (
            <div className="route-preview">
              <MapPanel route={preview.route} lang={lang} variant="preview" />
              <div className="preview-info">
                <span className="r-name">{preview.route.name[lang]}</span>
                <span>
                  {formatDistance(preview.route.length_m)} · {formatDuration(preview.route.duration_s)}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {micState === "denied" && (
        <div className="notice" role="alert">
          <span>Microphone access is needed to play by voice.</span>
          <button className="small-btn" onClick={start}>
            Retry
          </button>
        </div>
      )}
      {noStt && (
        <div className="notice">
          <span>Voice input works best in Chrome. Answers can also be typed in the Demo Panel (press D).</span>
        </div>
      )}
      <button className="start-btn" onClick={start} disabled={!canStart || micState === "checking"}>
        Start
      </button>
    </main>
  );
}
