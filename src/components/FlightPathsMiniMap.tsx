"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { createMapStyle } from "@/lib/mapStyle";
import { useSimStore } from "./useSimStore";
import { useThemeStore } from "./useThemeStore";
import type { Trajectory } from "@/lib/models";

type FlightPathsMiniMapProps = {
  flightIds?: string[];
  baselineFlightIds?: string[];
  className?: string;
};

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const SOURCE_ID = "mini-flight-paths";
const GLOW_LAYER_ID = "mini-flight-paths-glow";
const LINE_LAYER_ID = "mini-flight-paths-line";

function normalizeIds(ids?: string[]): string[] {
  if (!ids || ids.length === 0) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== "string") {
      const coerced = String(raw ?? "").trim();
      if (!coerced) continue;
      if (seen.has(coerced)) continue;
      seen.add(coerced);
      normalized.push(coerced);
      continue;
    }

    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function deriveLineColor(coords: [number, number][]): string {
  if (coords.length < 2) return "#38bdf8";
  const first = coords[0];
  const last = coords[coords.length - 1];
  const deltaLon = last[0] - first[0];
  const deltaLat = last[1] - first[1];
  const absLon = Math.abs(deltaLon);
  const absLat = Math.abs(deltaLat);

  if (absLon === 0 && absLat === 0) return "#38bdf8";

  if (absLon > absLat) {
    return deltaLon < 0 ? "#ec4899" : "#10b981";
  }

  return deltaLat > 0 ? "#ec4899" : "#10b981";
}

function buildFeatureCollection(flights: Trajectory[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const flight of flights) {
    if (!flight.coords || flight.coords.length < 2) continue;
    const coords2d = flight.coords.map(([lon, lat]) => [lon, lat] as [number, number]);
    if (coords2d.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords2d },
      properties: {
        flightId: flight.flightId,
        callSign: flight.callSign ?? flight.flightId,
        lineColor: deriveLineColor(coords2d),
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
  } satisfies GeoJSON.FeatureCollection;
}

function computeBounds(flights: Trajectory[]): LngLatBoundsLike | null {
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let hasCoordinate = false;

  for (const flight of flights) {
    for (const [lon, lat] of flight.coords) {
      if (typeof lon !== "number" || typeof lat !== "number") continue;
      hasCoordinate = true;
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  }

  if (!hasCoordinate) return null;

  if (Number.isFinite(minLon) && Number.isFinite(minLat) && Number.isFinite(maxLon) && Number.isFinite(maxLat)) {
    return [
      [minLon, minLat],
      [maxLon, maxLat],
    ];
  }

  return null;
}

export default function FlightPathsMiniMap({
  flightIds,
  baselineFlightIds,
  className,
}: FlightPathsMiniMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const theme = useThemeStore((state) => state.theme);
  const flights = useSimStore((state) => state.flights);

  const normalizedFlightIds = useMemo(() => normalizeIds(flightIds), [flightIds]);
  const normalizedBaselineIds = useMemo(() => normalizeIds(baselineFlightIds), [baselineFlightIds]);

  const flightsById = useMemo(() => {
    const lookup = new Map<string, Trajectory>();
    for (const flight of flights) {
      lookup.set(String(flight.flightId), flight);
    }
    return lookup;
  }, [flights]);

  const selectedFlights = useMemo(() => {
    if (normalizedFlightIds.length === 0) return [] as Trajectory[];
    const collected: Trajectory[] = [];
    for (const id of normalizedFlightIds) {
      const match = flightsById.get(id);
      if (match && match.coords.length > 1) {
        collected.push(match);
      }
    }
    return collected;
  }, [flightsById, normalizedFlightIds]);

  const baselineFlights = useMemo(() => {
    if (normalizedBaselineIds.length === 0) return [] as Trajectory[];
    const collected: Trajectory[] = [];
    for (const id of normalizedBaselineIds) {
      const match = flightsById.get(id);
      if (match && match.coords.length > 1) {
        collected.push(match);
      }
    }
    return collected;
  }, [flightsById, normalizedBaselineIds]);

  const flightsToDisplay = selectedFlights.length > 0 ? selectedFlights : baselineFlights;
  const hasFlights = flightsToDisplay.length > 0;

  const featureCollection = useMemo(
    () => (hasFlights ? buildFeatureCollection(flightsToDisplay) : EMPTY_FEATURE_COLLECTION),
    [flightsToDisplay, hasFlights],
  );

  const bounds = useMemo(() => (hasFlights ? computeBounds(flightsToDisplay) : null), [flightsToDisplay, hasFlights]);

  useEffect(() => {
    if (!containerRef.current) return;

    setMapReady(false);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: createMapStyle(theme, 512),
      center: [3, 45],
      zoom: 3,
      attributionControl: false,
      dragRotate: false,
      touchPitch: false,
      pitchWithRotate: false,
      renderWorldCopies: false,
      cooperativeGestures: true,
    });

    mapRef.current = map;

    const handleLoad = () => {
      setMapReady(true);
      map.resize();
    };

    map.on("load", handleLoad);

    return () => {
      map.off("load", handleLoad);
      map.remove();
      mapRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const ensureLayers = () => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: "geojson",
          data: featureCollection,
        });
      }

      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      source?.setData(featureCollection);

      if (!map.getLayer(GLOW_LAYER_ID)) {
        map.addLayer({
          id: GLOW_LAYER_ID,
          type: "line",
          source: SOURCE_ID,
          paint: {
            "line-color": ["coalesce", ["get", "lineColor"], "#38bdf8"],
            "line-width": 5,
            "line-opacity": 0.2,
            "line-blur": 1.5,
          },
        });
      }

      if (!map.getLayer(LINE_LAYER_ID)) {
        map.addLayer(
          {
            id: LINE_LAYER_ID,
            type: "line",
            source: SOURCE_ID,
            paint: {
              "line-color": ["coalesce", ["get", "lineColor"], "#38bdf8"],
              "line-width": 2.6,
              "line-opacity": 0.9,
              "line-blur": 0.4,
            },
          },
          GLOW_LAYER_ID,
        );
      }
    };

    ensureLayers();

    if (hasFlights && bounds) {
      const [[minLon, minLat], [maxLon, maxLat]] = bounds as [[number, number], [number, number]];
      const deltaLon = Math.abs(maxLon - minLon);
      const deltaLat = Math.abs(maxLat - minLat);
      const singlePoint = deltaLon < 1e-4 && deltaLat < 1e-4;
      const paddingBounds: LngLatBoundsLike = singlePoint
        ? [
            [minLon - 0.75, minLat - 0.75],
            [maxLon + 0.75, maxLat + 0.75],
          ]
        : bounds;

      map.fitBounds(paddingBounds, {
        padding: 32,
        maxZoom: singlePoint ? 6 : 7,
        duration: 0,
      });
    } else if (!hasFlights) {
      map.easeTo({ center: [3, 45], zoom: 3, duration: 0 });
    }
  }, [bounds, featureCollection, hasFlights, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !containerRef.current) return;
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      map.resize();
    });

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
    };
  }, [mapReady]);

  const rootClassName = ["relative h-full w-full", className].filter(Boolean).join(" ");

  return (
    <div className={rootClassName}>
      <div ref={containerRef} className="absolute inset-0" />
      {!mapReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-xs text-white/60">
          Loading map…
        </div>
      )}
      {mapReady && !hasFlights && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-xs text-white/60">
          No flight paths available
        </div>
      )}
    </div>
  );
}
