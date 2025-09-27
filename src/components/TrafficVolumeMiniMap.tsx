"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { createMapStyle } from "@/lib/mapStyle";
import { useThemeStore } from "./useThemeStore";
import { fetchTrafficVolumeFeature, getCachedTrafficVolumeFeature } from "@/lib/trafficVolumes";
import type { TrafficVolumeFeature } from "@/lib/trafficVolumes";

const SOURCE_ID = "mini-traffic-volume";
const FILL_LAYER_ID = "mini-traffic-volume-fill";
const OUTLINE_LAYER_ID = "mini-traffic-volume-outline";

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function normalizeId(id?: string | null): string {
  if (!id) return "";
  return String(id).trim();
}

function collectCoordinates(geometry: GeoJSON.Geometry | null | undefined): [number, number][] {
  if (!geometry) return [];
  const coords: [number, number][] = [];

  const pushCoords = (value: any) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      coords.push([Number(value[0]), Number(value[1])]);
      return;
    }
    for (const nested of value) {
      pushCoords(nested);
    }
  };

  switch (geometry.type) {
    case "Point":
      pushCoords(geometry.coordinates);
      break;
    case "MultiPoint":
    case "LineString":
    case "MultiLineString":
    case "Polygon":
    case "MultiPolygon":
      pushCoords(geometry.coordinates);
      break;
    default:
      break;
  }

  return coords.filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
}

function computeBounds(feature: TrafficVolumeFeature | null): LngLatBoundsLike | null {
  if (!feature || !feature.geometry) return null;
  const coords = collectCoordinates(feature.geometry);
  if (coords.length === 0) return null;
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLon) || !Number.isFinite(maxLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLat)) {
    return null;
  }

  const deltaLon = Math.abs(maxLon - minLon);
  const deltaLat = Math.abs(maxLat - minLat);
  const isSinglePoint = deltaLon < 1e-5 && deltaLat < 1e-5;

  if (isSinglePoint) {
    const padding = 0.5;
    return [
      [minLon - padding, minLat - padding],
      [maxLon + padding, maxLat + padding],
    ];
  }

  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

interface TrafficVolumeMiniMapProps {
  trafficVolumeId?: string | null;
  className?: string;
}

export default function TrafficVolumeMiniMap({ trafficVolumeId, className }: TrafficVolumeMiniMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [loadingFeature, setLoadingFeature] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feature, setFeature] = useState<TrafficVolumeFeature | null>(() => {
    const normalized = normalizeId(trafficVolumeId);
    if (!normalized) return null;
    return getCachedTrafficVolumeFeature(normalized);
  });

  const theme = useThemeStore((state) => state.theme);

  const normalizedId = useMemo(() => normalizeId(trafficVolumeId), [trafficVolumeId]);

  useEffect(() => {
    let cancelled = false;
    if (!normalizedId) {
      setFeature(null);
      setLoadError(null);
      setLoadingFeature(false);
      return () => { cancelled = true; };
    }

    const cached = getCachedTrafficVolumeFeature(normalizedId);
    if (cached) {
      setFeature(cached);
      setLoadError(null);
      setLoadingFeature(false);
      return () => { cancelled = true; };
    }

    setLoadingFeature(true);
    setLoadError(null);
    fetchTrafficVolumeFeature(normalizedId)
      .then((result) => {
        if (cancelled) return;
        setFeature(result ?? null);
        if (!result) {
          setLoadError("Traffic volume not found.");
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        setFeature(null);
        setLoadError(err?.message || "Failed to load traffic volume.");
      })
      .finally(() => {
        if (!cancelled) setLoadingFeature(false);
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedId]);

  useEffect(() => {
    if (!containerRef.current) return;

    setMapReady(false);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: createMapStyle(theme, 512),
      center: [3, 45],
      zoom: 4,
      attributionControl: false,
      interactive: false,
      renderWorldCopies: false,
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

  const featureCollection = useMemo(() => {
    if (!feature) return EMPTY_COLLECTION;
    return {
      type: "FeatureCollection",
      features: [feature],
    } as GeoJSON.FeatureCollection;
  }, [feature]);

  const bounds = useMemo(() => computeBounds(feature), [feature]);
  const hasFeature = Boolean(feature);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: featureCollection,
      });
    }

    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(featureCollection);

    if (!map.getLayer(FILL_LAYER_ID)) {
      map.addLayer({
        id: FILL_LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": "#38bdf8",
          "fill-opacity": 0.3,
        },
      });
    }

    if (!map.getLayer(OUTLINE_LAYER_ID)) {
      map.addLayer(
        {
          id: OUTLINE_LAYER_ID,
          type: "line",
          source: SOURCE_ID,
          paint: {
            "line-color": "#38bdf8",
            "line-width": 2.5,
            "line-opacity": 0.85,
          },
        },
        FILL_LAYER_ID,
      );
    }

    if (hasFeature && bounds) {
      map.fitBounds(bounds, {
        padding: 28,
        duration: 0,
        maxZoom: 7,
      });
    } else if (!hasFeature) {
      map.easeTo({ center: [3, 45], zoom: 3.5, duration: 0 });
    }
  }, [featureCollection, hasFeature, bounds, mapReady]);

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

  const showNoSelection = !normalizedId;
  const showLoading = normalizedId && loadingFeature;
  const showMissing = normalizedId && !loadingFeature && !hasFeature;

  return (
    <div className={rootClassName}>
      <div ref={containerRef} className="absolute inset-0" />
      {!mapReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-xs text-white/60">
          Loading map…
        </div>
      )}
      {mapReady && showNoSelection && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-xs text-white/60">
          Select a traffic volume to preview
        </div>
      )}
      {mapReady && showLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-xs text-white/60">
          Loading traffic volume…
        </div>
      )}
      {mapReady && showMissing && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-950/60 text-center text-xs text-rose-200">
          <span>Traffic volume not found.</span>
          {loadError && <span className="text-[11px] text-rose-300/80">{loadError}</span>}
        </div>
      )}
    </div>
  );
}
