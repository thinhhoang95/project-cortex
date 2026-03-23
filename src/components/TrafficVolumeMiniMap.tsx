"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { createMapStyle } from "@/lib/mapStyle";
import { useThemeStore } from "./useThemeStore";
import { fetchTrafficVolumeFeature, getCachedTrafficVolumeFeature } from "@/lib/trafficVolumes";
import type { TrafficVolumeFeature } from "@/lib/trafficVolumes";
import { getTrafficVolumeTheme } from "@/lib/trafficVolumeLayers";
import ShimmeringText from "./ShimmeringText";

const SOURCE_ID = "mini-traffic-volume";
const FILL_LAYER_ID = "mini-traffic-volume-fill";
const OUTLINE_LAYER_ID = "mini-traffic-volume-outline";
const POINT_LAYER_ID = "mini-traffic-volume-point";

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

function computeBounds(features: TrafficVolumeFeature[]): LngLatBoundsLike | null {
  const coords: [number, number][] = [];
  for (const feature of features) {
    if (!feature || !feature.geometry) continue;
    coords.push(...collectCoordinates(feature.geometry));
  }
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
  trafficVolumeIds?: (string | null | undefined)[];
  className?: string;
}

function normalizeIds(
  trafficVolumeId?: string | null,
  trafficVolumeIds?: (string | null | undefined)[],
): string[] {
  const set = new Set<string>();
  if (Array.isArray(trafficVolumeIds)) {
    for (const id of trafficVolumeIds) {
      const normalized = normalizeId(id);
      if (normalized) {
        set.add(normalized);
      }
    }
  }
  const single = normalizeId(trafficVolumeId);
  if (single) {
    set.add(single);
  }
  return Array.from(set);
}

export default function TrafficVolumeMiniMap({
  trafficVolumeId,
  trafficVolumeIds,
  className,
}: TrafficVolumeMiniMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [loadingFeature, setLoadingFeature] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [features, setFeatures] = useState<TrafficVolumeFeature[]>(() => {
    const normalized = normalizeIds(trafficVolumeId, trafficVolumeIds);
    if (!normalized.length) return [];
    const cached: TrafficVolumeFeature[] = [];
    for (const id of normalized) {
      const feature = getCachedTrafficVolumeFeature(id);
      if (feature) {
        cached.push(feature);
      }
    }
    return cached;
  });

  const theme = useThemeStore((state) => state.theme);

  const normalizedIds = useMemo(
    () => normalizeIds(trafficVolumeId, trafficVolumeIds),
    [trafficVolumeId, trafficVolumeIds],
  );

  useEffect(() => {
    let cancelled = false;
    if (!normalizedIds.length) {
      setFeatures([]);
      setLoadError(null);
      setLoadingFeature(false);
      return () => { cancelled = true; };
    }

    const cached: TrafficVolumeFeature[] = [];
    const missingIds: string[] = [];
    for (const id of normalizedIds) {
      const feature = getCachedTrafficVolumeFeature(id);
      if (feature) {
        cached.push(feature);
      } else {
        missingIds.push(id);
      }
    }

    if (missingIds.length === 0) {
      setFeatures(cached);
      setLoadError(null);
      setLoadingFeature(false);
      return () => {
        cancelled = true;
      };
    }

    setLoadingFeature(true);
    setLoadError(null);

    Promise.all(missingIds.map((id) => fetchTrafficVolumeFeature(id).catch(() => null)))
      .then((results) => {
        if (cancelled) return;
        const loaded = results.filter((feature): feature is TrafficVolumeFeature => Boolean(feature));
        const combined = [...cached, ...loaded];
        setFeatures(combined);
        if (combined.length === 0) {
          setLoadError("Traffic volume not found.");
        } else if (loaded.length !== missingIds.length) {
          setLoadError("Some traffic volumes could not be loaded.");
        } else {
          setLoadError(null);
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        setFeatures(cached);
        setLoadError(err?.message || "Failed to load traffic volume.");
      })
      .finally(() => {
        if (!cancelled) setLoadingFeature(false);
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedIds]);

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
    if (!features.length) return EMPTY_COLLECTION;
    return {
      type: "FeatureCollection",
      features,
    } as GeoJSON.FeatureCollection;
  }, [features]);

  const bounds = useMemo(() => computeBounds(features), [features]);
  const hasFeature = features.length > 0;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const colors = getTrafficVolumeTheme(theme);

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
          "fill-color": colors.polygonFill,
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
            "line-color": colors.polygonOutline,
            "line-width": 2.5,
            "line-opacity": 0.85,
          },
        },
        FILL_LAYER_ID,
      );
    }

    if (!map.getLayer(POINT_LAYER_ID)) {
      map.addLayer({
        id: POINT_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-color": colors.pointFill,
          "circle-radius": 6,
          "circle-opacity": 0.9,
          "circle-stroke-color": colors.pointStroke,
          "circle-stroke-width": 1.5,
        },
      });
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
  }, [featureCollection, hasFeature, bounds, mapReady, theme]);

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

  const showNoSelection = normalizedIds.length === 0;
  const showLoading = normalizedIds.length > 0 && loadingFeature;
  const showMissing = normalizedIds.length > 0 && !loadingFeature && !hasFeature;

  return (
    <div className={rootClassName}>
      <div ref={containerRef} className="absolute inset-0" />
      {!mapReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-xs text-white/60">
          <ShimmeringText text="Loading map…" className="text-xs text-white/60 font-normal" />
        </div>
      )}
      {mapReady && showNoSelection && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-xs text-white/60">
          Select traffic volume(s) to preview
        </div>
      )}
      {mapReady && showLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-xs text-white/60">
          <ShimmeringText text="Loading traffic volume data…" className="text-xs text-white/60 font-normal" />
        </div>
      )}
      {mapReady && showMissing && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-950/60 text-center text-xs text-rose-200">
          <span>Traffic volume data unavailable.</span>
          {loadError && <span className="text-[11px] text-rose-300/80">{loadError}</span>}
        </div>
      )}
    </div>
  );
}
