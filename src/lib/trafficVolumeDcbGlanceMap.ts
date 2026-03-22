import type maplibregl from "maplibre-gl";

import type { ThemeName } from "@/styles/theme";
import { TRAFFIC_VOLUME_LAYER_IDS } from "@/lib/trafficVolumeLayers";
import { buildTvDcbGlanceLabel, type TvDcbGlanceSummary } from "@/lib/tvDcbGlance";

export type AirspaceSources = {
  sectors: GeoJSON.FeatureCollection;
  centroids: GeoJSON.FeatureCollection;
};

export const TV_DCB_GLANCE_SOURCE_ID = "tv-dcb-glance";
export const TV_DCB_GLANCE_LAYER_ID = "sector-dcb-glance-labels";
export const TV_DCB_GLANCE_MIN_ZOOM = 6;
export const TV_DCB_GLANCE_DEFAULT_BIN_MINUTES = 15;

export function emptyPointFC(): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return { type: "FeatureCollection", features: [] };
}

export function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export function buildTvDcbGlanceCacheKey(
  tvId: string,
  resourceStateEpoch: number,
  referenceBinSeconds: number,
  glanceHorizonMinutes: number,
): string {
  return `${String(tvId)}|${resourceStateEpoch}|${referenceBinSeconds}|${glanceHorizonMinutes}`;
}

export function ensureTrafficVolumeDcbGlanceLayer(
  map: maplibregl.Map,
  theme: ThemeName,
): void {
  if (map.getLayer(TRAFFIC_VOLUME_LAYER_IDS.label)) {
    map.setLayerZoomRange(TRAFFIC_VOLUME_LAYER_IDS.label, 0, TV_DCB_GLANCE_MIN_ZOOM);
  }
  if (!map.getSource(TV_DCB_GLANCE_SOURCE_ID)) {
    map.addSource(TV_DCB_GLANCE_SOURCE_ID, {
      type: "geojson",
      data: emptyPointFC(),
    });
  }
  if (!map.getLayer(TV_DCB_GLANCE_LAYER_ID)) {
    map.addLayer({
      id: TV_DCB_GLANCE_LAYER_ID,
      type: "symbol",
      source: TV_DCB_GLANCE_SOURCE_ID,
      minzoom: TV_DCB_GLANCE_MIN_ZOOM,
      layout: {
        "text-field": ["coalesce", ["get", "dcb_full_text"], ["get", "label"]],
        "text-size": 10,
        "text-font": ["Noto Sans Regular"],
        "text-justify": "center",
        "text-anchor": "top",
        "text-offset": [0, 0.7],
        "text-allow-overlap": false,
        "text-ignore-placement": false,
      },
      paint: {
        "text-color": theme === "dark" ? "#cbd5f5" : "#dbeafe",
        "text-halo-color": theme === "dark" ? "#020617" : "#0f172a",
        "text-halo-width": 2,
      },
    });
  }
}

export function collectVisibleTrafficVolumeIdsForGlance(
  map: maplibregl.Map,
  options: { enabled: boolean; minZoom?: number },
): string[] {
  const minZoom = options.minZoom ?? TV_DCB_GLANCE_MIN_ZOOM;
  if (!options.enabled || !map.isStyleLoaded() || map.getZoom() < minZoom) {
    return [];
  }
  if (!map.getLayer(TRAFFIC_VOLUME_LAYER_IDS.fill)) {
    return [];
  }

  const features = map.queryRenderedFeatures(undefined, {
    layers: [TRAFFIC_VOLUME_LAYER_IDS.fill],
  });
  const ids = new Set<string>();
  for (const feature of features) {
    const tvId = String(feature?.properties?.traffic_volume_id ?? "").trim();
    if (!tvId) continue;
    ids.add(tvId);
  }
  return Array.from(ids).sort((left, right) => left.localeCompare(right));
}

export function buildTvDcbGlanceSourceData(params: {
  centroids: GeoJSON.FeatureCollection | null | undefined;
  visibleTvIds: string[];
  getSummary: (tvId: string) => TvDcbGlanceSummary | null;
  referenceSeconds: number;
}): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const { centroids, visibleTvIds, getSummary, referenceSeconds } = params;
  if (!centroids || visibleTvIds.length === 0) return emptyPointFC();

  const visibleIdSet = new Set(visibleTvIds);
  const features = (centroids.features || []).flatMap((feature) => {
    if (feature.geometry?.type !== "Point") return [];
    const properties = (feature.properties ?? {}) as Record<string, unknown>;
    if (properties.source_geom_type === "Point") return [];
    const tvId = String(properties.traffic_volume_id ?? "").trim();
    if (!tvId || !visibleIdSet.has(tvId)) return [];

    return [{
      ...feature,
      properties: {
        ...properties,
        dcb_full_text: buildTvDcbGlanceLabel(tvId, getSummary(tvId), referenceSeconds),
      },
    } as GeoJSON.Feature<GeoJSON.Point>];
  });

  return {
    type: "FeatureCollection",
    features,
  };
}

export function setDcbGlanceSourceData(
  map: maplibregl.Map | null,
  data: GeoJSON.FeatureCollection<GeoJSON.Point>,
): void {
  if (!map) return;
  const source = map.getSource(TV_DCB_GLANCE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  source.setData(data);
}
