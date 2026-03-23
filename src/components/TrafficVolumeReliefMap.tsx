"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { createMapStyle } from "@/lib/mapStyle";
import { useThemeStore } from "@/components/useThemeStore";
import {
  fetchTrafficVolumeFeature,
  getCachedTrafficVolumeFeature,
  type TrafficVolumeFeature,
} from "@/lib/trafficVolumes";
import { clipToDomain, computeRobustSymmetricDomain } from "@/lib/trafficVolumeRelief";
import ShimmeringText from "@/components/ShimmeringText";

const SOURCE_ID = "tv-relief-source";
const FILL_LAYER_ID = "tv-relief-fill";
const OUTLINE_LAYER_ID = "tv-relief-outline";
const POINT_LAYER_ID = "tv-relief-point";

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

type ReliefFeature = GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>;

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

  pushCoords((geometry as any).coordinates);
  return coords.filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
}

function computeBounds(features: TrafficVolumeFeature[]): LngLatBoundsLike | null {
  const coords: [number, number][] = [];
  for (const feature of features) {
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

  if (!Number.isFinite(minLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLon) || !Number.isFinite(maxLat)) {
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

function buildSignedReliefColorExpression(domain: number): any[] {
  const d = Math.max(1e-6, Math.abs(domain));
  return [
    "interpolate",
    ["linear"],
    ["to-number", ["coalesce", ["get", "relief_delta"], 0]],
    -d,
    "#16a34a",
    -d * 0.5,
    "#86efac",
    0,
    "#94a3b8",
    d * 0.5,
    "#fca5a5",
    d,
    "#dc2626",
  ];
}

function buildAbsoluteReliefColorExpression(domain: number): any[] {
  const d = Math.max(1e-6, Math.abs(domain));
  return [
    "interpolate",
    ["linear"],
    ["to-number", ["coalesce", ["get", "relief_delta"], 0]],
    0,
    "#dbeafe",
    d * 0.25,
    "#93c5fd",
    d * 0.5,
    "#38bdf8",
    d * 0.75,
    "#0ea5e9",
    d,
    "#075985",
  ];
}

function formatLegendValue(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  if (abs >= 100) {
    return Math.round(value).toLocaleString();
  }
  if (abs >= 10) {
    return value.toFixed(1).replace(/\.0$/, "");
  }
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

interface TrafficVolumeReliefMapProps {
  deltasByTv: Record<string, number>;
  className?: string;
  heightClassName?: string;
  loading?: boolean;
  emptyMessage?: string;
  negativeLegendLabel?: string;
  positiveLegendLabel?: string;
  colorMode?: "signed" | "absolute";
  domainMax?: number | null;
  valueLabel?: string;
}

export default function TrafficVolumeReliefMap({
  deltasByTv,
  className,
  heightClassName = "h-[260px]",
  loading,
  emptyMessage = "No pre/post occupancy deltas available for this view.",
  negativeLegendLabel = "Relief",
  positiveLegendLabel = "Strain",
  colorMode = "signed",
  domainMax,
  valueLabel = "TV metrics",
}: TrafficVolumeReliefMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [loadingFeature, setLoadingFeature] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [features, setFeatures] = useState<TrafficVolumeFeature[]>([]);
  const theme = useThemeStore((state) => state.theme);

  const deltaEntries = useMemo(() => {
    const next = new Map<string, number>();
    Object.entries(deltasByTv || {}).forEach(([rawId, rawDelta]) => {
      const id = normalizeId(rawId);
      const delta = Number(rawDelta);
      if (!id || !Number.isFinite(delta)) return;
      next.set(id, delta);
    });
    return Array.from(next.entries());
  }, [deltasByTv]);

  const normalizedIds = useMemo(() => deltaEntries.map(([id]) => id), [deltaEntries]);
  const hasDeltaData = normalizedIds.length > 0;

  const reliefDomain = useMemo(() => {
    if (Number.isFinite(domainMax)) {
      return Math.max(1, Number(domainMax));
    }
    if (colorMode === "absolute") {
      const maxValue = deltaEntries.reduce((acc, [, delta]) => Math.max(acc, Math.abs(delta)), 0);
      return Math.max(1, maxValue);
    }
    return computeRobustSymmetricDomain(deltaEntries.map(([, delta]) => delta), 0.95, 1);
  }, [colorMode, deltaEntries, domainMax]);

  const decoratedFeatureCollection = useMemo(() => {
    if (!features.length) return EMPTY_COLLECTION;
    const deltaById = new Map(deltaEntries);
    const decorated: ReliefFeature[] = features.map((feature) => {
      const tvId = normalizeId(String((feature.properties as any)?.traffic_volume_id ?? ""));
      const rawDelta = Number(deltaById.get(tvId) ?? 0);
      const clipped = clipToDomain(rawDelta, reliefDomain);
      return {
        ...feature,
        properties: {
          ...(feature.properties || {}),
          relief_delta_raw: rawDelta,
          relief_delta: clipped,
        },
      } as ReliefFeature;
    });
    return {
      type: "FeatureCollection",
      features: decorated,
    } as GeoJSON.FeatureCollection;
  }, [features, deltaEntries, reliefDomain]);

  const bounds = useMemo(() => computeBounds(features), [features]);

  const unresolvedCount = useMemo(() => {
    const resolved = new Set(
      features
        .map((feature) => normalizeId(String((feature.properties as any)?.traffic_volume_id ?? "")))
        .filter((id) => id.length > 0),
    );
    return normalizedIds.filter((id) => !resolved.has(id)).length;
  }, [features, normalizedIds]);

  useEffect(() => {
    let cancelled = false;
    if (!normalizedIds.length) {
      setFeatures([]);
      setLoadError(null);
      setLoadingFeature(false);
      return () => {
        cancelled = true;
      };
    }

    const cached: TrafficVolumeFeature[] = [];
    const missing: string[] = [];
    for (const id of normalizedIds) {
      const feature = getCachedTrafficVolumeFeature(id);
      if (feature) {
        cached.push(feature);
      } else {
        missing.push(id);
      }
    }

    if (missing.length === 0) {
      setFeatures(cached);
      setLoadError(null);
      setLoadingFeature(false);
      return () => {
        cancelled = true;
      };
    }

    setLoadingFeature(true);
    setLoadError(null);

    Promise.all(missing.map((id) => fetchTrafficVolumeFeature(id).catch(() => null)))
      .then((loaded) => {
        if (cancelled) return;
        const loadedFeatures = loaded.filter((feature): feature is TrafficVolumeFeature => Boolean(feature));
        const next = [...cached, ...loadedFeatures];
        setFeatures(next);
        if (next.length === 0) {
          setLoadError("Traffic volume geometry not found.");
        } else if (loadedFeatures.length !== missing.length) {
          setLoadError("Some traffic volume geometries could not be loaded.");
        } else {
          setLoadError(null);
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        setFeatures(cached);
        setLoadError(err?.message || "Failed to load traffic volumes.");
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingFeature(false);
        }
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const colorExpression = colorMode === "absolute"
      ? buildAbsoluteReliefColorExpression(reliefDomain)
      : buildSignedReliefColorExpression(reliefDomain);

    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: decoratedFeatureCollection,
      });
    }
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData(decoratedFeatureCollection);

    if (!map.getLayer(FILL_LAYER_ID)) {
      map.addLayer({
        id: FILL_LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": colorExpression as any,
          "fill-opacity": 0.45,
        },
      });
    } else {
      map.setPaintProperty(FILL_LAYER_ID, "fill-color", colorExpression as any);
      map.setPaintProperty(FILL_LAYER_ID, "fill-opacity", 0.45);
    }

    if (!map.getLayer(OUTLINE_LAYER_ID)) {
      map.addLayer({
        id: OUTLINE_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": "rgba(226,232,240,0.85)",
          "line-width": 1.6,
          "line-opacity": 0.55,
        },
      });
    }

    if (!map.getLayer(POINT_LAYER_ID)) {
      map.addLayer({
        id: POINT_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-color": colorExpression as any,
          "circle-radius": 5.5,
          "circle-opacity": 0.95,
          "circle-stroke-color": "rgba(15,23,42,0.9)",
          "circle-stroke-width": 1.2,
        },
      });
    } else {
      map.setPaintProperty(POINT_LAYER_ID, "circle-color", colorExpression as any);
    }

    if (features.length > 0 && bounds) {
      map.fitBounds(bounds, {
        padding: 24,
        duration: 0,
        maxZoom: 7,
      });
    } else {
      map.easeTo({ center: [3, 45], zoom: 3.5, duration: 0 });
    }
  }, [mapReady, decoratedFeatureCollection, reliefDomain, features, bounds, colorMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !containerRef.current) return;
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      map.resize();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [mapReady]);

  const rootClassName = ["w-full", className].filter(Boolean).join(" ");
  const mapContainerClassName = ["relative w-full overflow-hidden rounded-lg border border-white/10 bg-slate-950/75", heightClassName]
    .filter(Boolean)
    .join(" ");

  const effectiveLoading = Boolean(loading) || loadingFeature;
  const showEmpty = !effectiveLoading && !hasDeltaData;
  const showMissing = !effectiveLoading && hasDeltaData && features.length === 0;
  const rangeLabel = colorMode === "absolute"
    ? `0 to ${formatLegendValue(reliefDomain)}`
    : `${formatLegendValue(-reliefDomain)} to ${formatLegendValue(reliefDomain)}`;
  const legendGradient = colorMode === "absolute"
    ? "bg-[linear-gradient(90deg,#dbeafe_0%,#93c5fd_25%,#38bdf8_50%,#0ea5e9_75%,#075985_100%)]"
    : "bg-[linear-gradient(90deg,#16a34a_0%,#86efac_35%,#94a3b8_50%,#fca5a5_65%,#dc2626_100%)]";

  return (
    <div className={rootClassName}>
      <div className={mapContainerClassName}>
        <div ref={containerRef} className="absolute inset-0" />

        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-xs text-white/60">
            <ShimmeringText text="Loading map…" className="text-xs text-white/60 font-normal" />
          </div>
        )}
        {mapReady && effectiveLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-xs text-white/60">
            <ShimmeringText text="Loading traffic volume data…" className="text-xs text-white/60 font-normal" />
          </div>
        )}
        {mapReady && showEmpty && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 text-xs text-white/65">
            {emptyMessage}
          </div>
        )}
        {mapReady && showMissing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-slate-950/60 text-center text-xs text-rose-200">
            <span>Traffic volume geometry unavailable.</span>
            {loadError && <span className="text-[11px] text-rose-300/80">{loadError}</span>}
          </div>
        )}
      </div>

      <div className="mt-3 space-y-1.5">
        <div className={`h-2.5 w-full rounded-full ${legendGradient}`} />
        <div className="flex items-center justify-between text-[11px] text-white/65">
          <span>{negativeLegendLabel}</span>
          <span className="font-mono text-white/75">{rangeLabel}</span>
          <span>{positiveLegendLabel}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-white/55">
          <span>{deltaEntries.length} {valueLabel}</span>
          {unresolvedCount > 0 && <span>{unresolvedCount} without geometry</span>}
        </div>
      </div>
    </div>
  );
}
