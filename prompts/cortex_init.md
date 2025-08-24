Awesome project. Below is a concrete, SWE-ready plan to ship a full-screen Next.js + Tailwind CSS map that loads flight trajectories and airspace polygons, draws labels along them, and animates little plane icons at interpolated positions for a selectable time window.

---

# 0) Tech stack & key decisions

* **Framework:** Next.js 14 (App Router) + TypeScript.
* **Map engine:** **MapLibre GL JS** (OSS Mapbox GL). Supports symbol labels along lines (`symbol-placement: "line"`), dynamic GeoJSON sources, and high-performance WebGL rendering.
* **Geospatial helpers:** `@turf/turf` (centroids, length, bearings, along/interpolate).
* **CSV parsing:** `papaparse`.
* **State:** light-weight via React state + `zustand` (for time/filters), or React Context if you prefer.
* **Animation worker:** Web Worker to compute current positions off the main thread (keeps the map smooth).
* **Testing:** Vitest + Playwright smoke test.

---

# 1) Repo bootstrapping

**Tasks**

1. `npx create-next-app@latest flightmap --ts --eslint --src-dir --app --tailwind`
2. Add deps:

   ```bash
   npm i maplibre-gl @turf/turf papaparse zustand
   npm i -D vitest @testing-library/react @types/maplibre-gl
   ```
3. In `tailwind.config.js`, enable `app/**/*.{ts,tsx}`.
4. Add public assets: `/public/plane.png` (simple north-up plane glyph), `/public/data/flights.csv`, `/public/data/airspace.json` (your FeatureCollection).
5. Configure strict CSP later (MapLibre needs `worker-src blob:`).

**Definition of done (DoD)**

* App runs at `/` with Tailwind working.
* Linting + typecheck pass in CI.

---

# 2) File/folder structure

```
app/
  layout.tsx
  page.tsx
components/
  MapCanvas.tsx
  GlassControls.tsx
  Legend.tsx
lib/
  models.ts
  time.ts
  flights.ts
  airspace.ts
  workers/
    sim.worker.ts
public/
  plane.png
  data/airspace.json
  data/flights.csv
styles/
  globals.css
```

---

# 3) Data model & parsing utilities

**`lib/models.ts`**

```ts
export type HmsCompact = string; // e.g., "754" => 00:07:54, "50007" => 05:00:07

export interface FlightSegment {
  segment_identifier: string;
  flight_identifier: string;
  call_sign: string;
  origin_aerodrome: string;
  destination_aerodrome: string;
  date_begin_segment: string; // e.g., "230801"
  date_end_segment: string;
  time_begin_segment: HmsCompact;
  time_end_segment: HmsCompact;
  latitude_begin: number;
  longitude_begin: number;
  latitude_end: number;
  longitude_end: number;
  flight_level_begin: number;
  flight_level_end: number;
  sequence: number;
}

export interface Trajectory {
  flightId: string;
  callSign?: string;
  // coordinates sorted by time
  coords: [number, number, number?][]; // [lon, lat, alt_ft]
  t0: number; // seconds since midnight
  t1: number; // seconds since midnight
  // per-vertex absolute time (sec since midnight)
  times: number[];
}

export interface SectorFeatureProps {
  traffic_volume_id: string;
  name?: string;
  min_fl: number;
  max_fl: number;
  [k: string]: unknown;
}
```

**`lib/time.ts`**

```ts
export function parseCompactHMS(s: string): number {
  // "754" -> 00:07:54, "50007" -> 05:00:07
  const p = s.trim();
  const sec = parseInt(p.slice(-2) || "0", 10);
  const min = parseInt(p.slice(-4, -2) || "0", 10);
  const hr  = parseInt(p.slice(0, -4) || "0", 10);
  return hr * 3600 + min * 60 + sec;
}

export function parseYYMMDD(d: string): Date {
  const y = 2000 + parseInt(d.slice(0, 2), 10);
  const m = parseInt(d.slice(2, 4), 10) - 1;
  const day = parseInt(d.slice(4, 6), 10);
  return new Date(Date.UTC(y, m, day));
}
```

**`lib/flights.ts`**

```ts
import Papa from "papaparse";
import * as turf from "@turf/turf";
import { FlightSegment, Trajectory } from "./models";
import { parseCompactHMS } from "./time";

// Load & group CSV into trajectories
export async function loadTrajectories(csvUrl: string): Promise<Trajectory[]> {
  const text = await fetch(csvUrl).then(r => r.text());
  const { data } = Papa.parse<FlightSegment>(text, { header: true, dynamicTyping: true, skipEmptyLines: true });

  const byFlight = new Map<string, FlightSegment[]>();
  for (const row of data as FlightSegment[]) {
    if (!row?.flight_identifier) continue;
    const arr = byFlight.get(row.flight_identifier) ?? [];
    arr.push(row);
    byFlight.set(row.flight_identifier, arr);
  }

  const trajectories: Trajectory[] = [];
  for (const [flightId, segs] of byFlight) {
    segs.sort((a, b) => a.sequence - b.sequence);
    const coords: [number, number, number?][] = [];
    const times: number[] = [];

    for (const s of segs) {
      const t0 = parseCompactHMS(String(s.time_begin_segment));
      const t1 = parseCompactHMS(String(s.time_end_segment));
      // push begin & end points (avoid duplicate when contiguous)
      const p0: [number, number, number?] = [s.longitude_begin, s.latitude_begin, s.flight_level_begin * 100];
      const p1: [number, number, number?] = [s.longitude_end, s.latitude_end, s.flight_level_end * 100];

      if (coords.length === 0 || coords.at(-1)![0] !== p0[0] || coords.at(-1)![1] !== p0[1]) {
        coords.push(p0);
        times.push(t0);
      }
      coords.push(p1);
      times.push(t1);
    }

    trajectories.push({
      flightId,
      callSign: segs[0]?.call_sign,
      coords,
      t0: times[0] ?? 0,
      t1: times.at(-1) ?? 0,
      times
    });
  }
  return trajectories;
}
```

**`lib/airspace.ts`**

```ts
export async function loadSectors(url: string): Promise<GeoJSON.FeatureCollection> {
  return fetch(url).then(r => r.json());
}
```

---

# 4) Map page, full-screen layout, and “glassy” controls

**`app/page.tsx`**

```tsx
import MapCanvas from "@/components/MapCanvas";
import GlassControls from "@/components/GlassControls";

export default function Page() {
  return (
    <main className="h-dvh w-screen overflow-hidden bg-slate-900 relative">
      <MapCanvas />
      <GlassControls />
    </main>
  );
}
```

**`components/GlassControls.tsx`** (glassy, top-left; provides time range + play/pause)

```tsx
"use client";
import { useSimStore } from "@/components/useSimStore";

export default function GlassControls() {
  const { t, range, setRange, playing, setPlaying, speed, setSpeed } = useSimStore();
  return (
    <div className="absolute top-4 left-4 z-50 min-w-[280px] max-w-[360px]
                    rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md
                    shadow-xl p-4 text-slate-900">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">Time of day</h2>
        <button
          onClick={() => setPlaying(!playing)}
          className="px-3 py-1.5 rounded-xl border border-white/30 bg-white/30 hover:bg-white/40 text-sm"
        >
          {playing ? "Pause" : "Play"}
        </button>
      </div>

      <div className="text-sm mb-2 opacity-80">T = {fmt(t)} (speed {speed}×)</div>

      <input
        type="range"
        min={range[0]} max={range[1]} step={1}
        value={t}
        onChange={(e) => setRange([range[0], range[1]], Number(e.currentTarget.value))}
        className="w-full"
      />

      <div className="mt-3 flex items-center gap-2">
        <label className="text-sm">Speed</label>
        <select
          className="rounded-lg bg-white/50 px-2 py-1 text-sm"
          value={speed}
          onChange={(e) => setSpeed(Number(e.currentTarget.value))}
        >
          {[0.5,1,2,5,10].map(x => <option key={x} value={x}>{x}×</option>)}
        </select>
      </div>
    </div>
  );
}

function fmt(sec: number) {
  const h = Math.floor(sec/3600).toString().padStart(2,"0");
  const m = Math.floor((sec%3600)/60).toString().padStart(2,"0");
  const s = Math.floor(sec%60).toString().padStart(2,"0");
  return `${h}:${m}:${s}`;
}
```

**`components/useSimStore.ts`** (central sim state)

```ts
"use client";
import { create } from "zustand";

type State = {
  t: number;               // current sim time (s)
  range: [number, number]; // global window
  speed: number;
  playing: boolean;
  setRange: (r: [number, number], t?: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (v: number) => void;
  tick: (dtMs: number) => void;
};

export const useSimStore = create<State>((set, get) => ({
  t: 0,
  range: [0, 24*3600],
  playing: false,
  speed: 1,
  setRange: (r, t = get().t) => set({ range: r, t }),
  setPlaying: (p) => set({ playing: p }),
  setSpeed: (v) => set({ speed: v }),
  tick: (dtMs) => {
    const { playing, speed, t, range } = get();
    if (!playing) return;
    const dt = (dtMs/1000) * speed;
    const next = t + dt;
    set({ t: next > range[1] ? range[0] : next });
  }
}));
```

---

# 5) Map initialization and base layers

**`components/MapCanvas.tsx`**

```tsx
"use client";
import maplibregl, { LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { loadTrajectories } from "@/lib/flights";
import { loadSectors } from "@/lib/airspace";
import * as turf from "@turf/turf";
import { useSimStore } from "./useSimStore";

export default function MapCanvas() {
  const mapRef = useRef<maplibregl.Map|null>(null);
  const rafRef = useRef<number>();
  const lastTs = useRef<number>(performance.now());
  const { t, tick, range, setRange } = useSimStore();

  // init map
  useEffect(() => {
    const map = new maplibregl.Map({
      container: "map",
      style: `https://demotiles.maplibre.org/style.json`, // swap with your tiles/style
      center: [3, 45],
      zoom: 4
    });
    mapRef.current = map;

    map.on("load", async () => {
      // Data
      const [sectors, tracks] = await Promise.all([
        loadSectors("/data/airspace.geojson"),
        loadTrajectories("/data/flights.csv")
      ]);

      // Compute global time range
      const minT = Math.min(...tracks.map(t => t.t0));
      const maxT = Math.max(...tracks.map(t => t.t1));
      setRange([minT, maxT], minT);

      // --- Airspace polygons + labels ---
      map.addSource("sectors", { type: "geojson", data: sectors });

      map.addLayer({
        id: "sector-fill",
        type: "fill",
        source: "sectors",
        paint: { "fill-color": "#d946ef", "fill-opacity": 0.15 }
      });
      map.addLayer({
        id: "sector-outline",
        type: "line",
        source: "sectors",
        paint: { "line-color": "#d946ef", "line-width": 1.0, "line-opacity": 0.7 }
      });
      // center labels via centroid points
      const centroids = {
        type: "FeatureCollection",
        features: (sectors.features as any[]).map((f) => {
          const c = turf.centroid(f as any);
          c.properties = { ...f.properties, label: f.properties?.traffic_volume_id || "" };
          return c;
        })
      } as GeoJSON.FeatureCollection;
      map.addSource("sector-centroids", { type: "geojson", data: centroids });
      map.addLayer({
        id: "sector-labels",
        type: "symbol",
        source: "sector-centroids",
        layout: {
          "text-field": ["get", "label"],
          "text-size": 12
        },
        paint: { "text-color": "#581c87", "text-halo-color": "#ffffff", "text-halo-width": 1 }
      });

      // --- Flight lines (static geometry) ---
      const lineFC: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: tracks.map(tr => ({
          type: "Feature",
          geometry: { type: "LineString", coordinates: tr.coords.map(c=>[c[0], c[1]]) },
          properties: { flightId: tr.flightId, callSign: tr.callSign ?? tr.flightId }
        }))
      };
      map.addSource("flight-lines", { type: "geojson", data: lineFC });
      map.addLayer({
        id: "flight-lines",
        type: "line",
        source: "flight-lines",
        paint: { "line-color": "#0ea5e9", "line-width": 2 }
      });
      // labels along the routes
      map.addLayer({
        id: "flight-line-labels",
        type: "symbol",
        source: "flight-lines",
        layout: {
          "symbol-placement": "line",
          "text-field": ["get", "callSign"],
          "text-size": 11
        },
        paint: { "text-color": "#075985", "text-halo-color": "#ffffff", "text-halo-width": 1 }
      });

      // --- Dynamic plane positions (updated each frame) ---
      map.addImage("plane", await loadImage(map, "/plane.png"), { pixelRatio: 2 });
      map.addSource("planes", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "plane-icons",
        type: "symbol",
        source: "planes",
        layout: {
          "icon-image": "plane",
          "icon-size": 0.6,
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "text-field": ["get", "callSign"],
          "text-offset": [0, 1],
          "text-size": 11
        },
        paint: {
          "text-halo-color": "#ffffff",
          "text-halo-width": 1
        }
      });

      // Save trajectories on map for the animation step
      (map as any).__trajectories = tracks;

      // Fit to data (optional)
      const b = new maplibregl.LngLatBounds();
      lineFC.features.forEach(f => (f.geometry as any).coordinates.forEach(([x,y]) => b.extend([x,y])));
      if (b) map.fitBounds(b as LngLatBoundsLike, { padding: 60, duration: 0 });
    });

    // RAF loop (time progression + plane updates)
    const loop = () => {
      const now = performance.now();
      const dt = now - lastTs.current;
      lastTs.current = now;
      tick(dt);
      updatePlanePositions(mapRef.current);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      map.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // on t change from UI (drag), update plane positions immediately
  useEffect(() => { updatePlanePositions(mapRef.current); }, [t]);

  return <div id="map" className="absolute inset-0" />;
}

function emptyFC(): GeoJSON.FeatureCollection { return { type: "FeatureCollection", features: [] }; }

async function loadImage(map: maplibregl.Map, url: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

// Interpolate each trajectory at current sim time and update the "planes" source
function updatePlanePositions(map: maplibregl.Map | null) {
  if (!map || !map.isStyleLoaded()) return;
  const sim = useSimStore.getState();
  const tracks = (map as any).__trajectories as any[] | undefined;
  if (!tracks) return;

  const planesFC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

  for (const tr of tracks) {
    if (sim.t < tr.t0 || sim.t > tr.t1) continue;

    // find segment i such that times[i] <= t <= times[i+1]
    const idx = Math.max(0, tr.times.findIndex((tt: number, i: number) => sim.t >= tt && sim.t <= tr.times[i+1]));
    const t0 = tr.times[idx], t1 = tr.times[idx+1];
    const p0 = tr.coords[idx], p1 = tr.coords[idx+1];
    const u = t1 === t0 ? 0 : (sim.t - t0) / (t1 - t0);

    const lon = p0[0] + (p1[0]-p0[0]) * u;
    const lat = p0[1] + (p1[1]-p0[1]) * u;

    // bearing for icon rotation
    const bearing = turf.bearing([p0[0], p0[1]], [p1[0], p1[1]]);

    planesFC.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { flightId: tr.flightId, callSign: tr.callSign ?? tr.flightId, bearing }
    });
  }

  const src = map.getSource("planes") as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(planesFC);
}
```

---

# 6) Labels along trajectories & polygons

* Already covered above:

  * **Routes:** `symbol` layer with `symbol-placement: "line"` and `text-field` = call sign.
  * **Polygons:** add a centroid point layer and `text-field` == `traffic_volume_id` (or `name`).
* For denser text along long lines, optionally split into multi-segment features and put multiple labels (future enhancement).

---

# 7) Simulation worker (optional, next iteration)

When trajectories get large, move interpolation into a **Web Worker** that:

* Receives `{ t, trajectories }` (trajectories preprocessed into Float64 arrays and times).
* Returns an array of `{lon,lat,bearing,callSign}` for visible flights in window `[t-Δ, t+Δ]`.
* Main thread only calls `geojsonSource.setData()` with the result.

(`lib/workers/sim.worker.ts` using `comlink` is a good pattern.)

---

# 8) Time filtering (selected period)

* With the store’s `range`, filter flights whose `[t0,t1]` intersects the selected time window.
* Update:

  * Line layer **filter** to only show intersecting flights (e.g., maintain a set of `flightId`s, filter with `["in", ["get","flightId"], ["literal", ids]]`).
  * Worker/loop should also ignore non-intersecting flights.

---

# 9) Loading the provided samples

* Drop your provided **CSV** to `/public/data/flights.csv`. The parser handles `time_begin_segment`/`time_end_segment` in compact HMS (e.g., `754`, `1408`, `50007`) and builds a polyline per `flight_identifier`.
* Drop the **Airspace Traffic Volumes GeoJSON** in `/public/data/airspace.json`. The polygons are drawn with outline + fill + centroid labels.

---

# 10) UX polish

* Add a **legend** toggle in the glassy panel.
* Hover tooltips for sector info (`min_fl`–`max_fl`) and flight info (call sign, FL).
* Keyboard: space to play/pause, arrow keys to nudge time.
* Persist UI state in `localStorage`.

---

# 11) Performance checklist

* Use a **single** GeoJSON source for planes and a **single** for lines; avoid per-flight layers.
* RAF update ≤ 10–15 Hz for planes is enough; lerp visually between ticks if needed.
* For huge datasets, pre-resample lines to \~1–2 km between points to cap per-frame search cost.
* Debounce slider updates.

---

# 12) Tests & acceptance criteria

* **Unit:** `parseCompactHMS` (“754”→474; “50007”→18007).
* **Unit:** trajectory grouping and time arrays are strictly increasing.
* **Playwright smoke:** page loads, map style loads, one plane icon appears within 2s when `t` set to a time inside a known track.
* **Visual:** route labels follow the line, sector labels appear near polygon centers, glass box stays fixed at top-left.

---

## What you’ll have after executing the plan

* A full-screen Next.js app with a **glassy control box** (top-left) to play/pause and scrub the **time of day**.
* **Airspace polygons** (with labels) and **flight trajectories** (with labels along lines).
* **Animated plane icons** showing current interpolated positions for flights active in the selected time window.
* Clean architecture ready for adding more data, clustering, filters, altitude coloring, etc.
