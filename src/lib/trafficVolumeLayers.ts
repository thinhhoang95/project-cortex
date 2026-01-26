import type maplibregl from "maplibre-gl";
import * as turf from "@turf/turf";
import type { ThemeName } from "@/styles/theme";
import { getTrafficVolumeFlIntersectionFilter } from "@/lib/mapUtils";

export const TRAFFIC_VOLUME_SOURCE_ID = "sectors";
export const TRAFFIC_VOLUME_CENTROIDS_SOURCE_ID = "tv-centroids";

export const TRAFFIC_VOLUME_LAYER_IDS = {
  fill: "sector-fill",
  outline: "sector-outline",
  label: "sector-labels",
  pointLabel: "sector-point-labels",
  pointHoverLabel: "sector-point-hover-labels",
  point: "sector-point",
  highlight: "sector-highlight",
  highlightOutline: "sector-highlight-outline",
  hover: "sector-hover",
  hoverOutline: "sector-hover-outline",
  hotspot: "sector-hotspot",
  hotspotOutline: "sector-hotspot-outline",
  pointHighlight: "sector-point-highlight",
  pointHover: "sector-point-hover",
  pointHotspot: "sector-point-hotspot",
} as const;

type TrafficVolumeTheme = {
  polygonFill: string;
  polygonOutline: string;
  labelColor: string;
  labelHalo: string;
  pointFill: string;
  pointStroke: string;
  selected: string;
  hover: string;
  hotspot: string;
};

const TRAFFIC_VOLUME_THEMES: Record<ThemeName, TrafficVolumeTheme> = {
  light: {
    polygonFill: "#3b82f6",
    polygonOutline: "#3b82f6",
    labelColor: "#60a5fa",
    labelHalo: "#0f172a",
    pointFill: "#60a5fa",
    pointStroke: "#0f172a",
    selected: "#fbbf24",
    hover: "#06b6d4",
    hotspot: "#ef4444",
  },
  dark: {
    polygonFill: "#3b82f6",
    polygonOutline: "#3b82f6",
    labelColor: "#93c5fd",
    labelHalo: "#020617",
    pointFill: "#93c5fd",
    pointStroke: "#020617",
    selected: "#fbbf24",
    hover: "#06b6d4",
    hotspot: "#ef4444",
  },
};

export function getTrafficVolumeTheme(theme: ThemeName): TrafficVolumeTheme {
  return TRAFFIC_VOLUME_THEMES[theme] ?? TRAFFIC_VOLUME_THEMES.light;
}

const POLYGON_ONLY_FILTER: any[] = ["!=", ["get", "source_geom_type"], "Point"];
const NONAS_POINT_FILTER: any[] = [
  "all",
  ["==", ["get", "source_geom_type"], "Point"],
  ["==", ["get", "tv_kind"], "nonas"],
];

function mergeFilters(filters: Array<any[] | null | undefined>): any[] {
  const active = filters.filter(Boolean) as any[][];
  if (active.length === 0) return ["==", 1, 0];
  if (active.length === 1) return active[0];
  return ["all", ...active];
}

function getBaseFilterForLayer(layerId: string): any[] | null {
  switch (layerId) {
    case TRAFFIC_VOLUME_LAYER_IDS.fill:
    case TRAFFIC_VOLUME_LAYER_IDS.outline:
    case TRAFFIC_VOLUME_LAYER_IDS.highlight:
    case TRAFFIC_VOLUME_LAYER_IDS.highlightOutline:
    case TRAFFIC_VOLUME_LAYER_IDS.hover:
    case TRAFFIC_VOLUME_LAYER_IDS.hoverOutline:
    case TRAFFIC_VOLUME_LAYER_IDS.hotspot:
    case TRAFFIC_VOLUME_LAYER_IDS.hotspotOutline:
    case TRAFFIC_VOLUME_LAYER_IDS.label:
      return POLYGON_ONLY_FILTER;
    case TRAFFIC_VOLUME_LAYER_IDS.point:
    case TRAFFIC_VOLUME_LAYER_IDS.pointLabel:
    case TRAFFIC_VOLUME_LAYER_IDS.pointHoverLabel:
    case TRAFFIC_VOLUME_LAYER_IDS.pointHighlight:
    case TRAFFIC_VOLUME_LAYER_IDS.pointHover:
    case TRAFFIC_VOLUME_LAYER_IDS.pointHotspot:
      return NONAS_POINT_FILTER;
    default:
      return null;
  }
}

function normalizeFeature(feature: GeoJSON.Feature): GeoJSON.Feature {
  const geometryType = feature.geometry?.type;
  const sourceGeomType = geometryType === "Point" ? "Point" : "Polygon";
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const tvKind = typeof props.tv_kind === "string" ? props.tv_kind : "airspace";
  return {
    ...feature,
    properties: {
      ...props,
      source_geom_type: sourceGeomType,
      tv_kind: tvKind,
    },
  };
}

function buildCentroidFeature(feature: GeoJSON.Feature): GeoJSON.Feature<GeoJSON.Point> | null {
  const props = (feature.properties ?? {}) as Record<string, unknown>;
  const tvId = props.traffic_volume_id != null ? String(props.traffic_volume_id) : "";
  const sourceGeomType = props.source_geom_type === "Point" ? "Point" : "Polygon";

  let centroid: GeoJSON.Feature<GeoJSON.Point> | null = null;
  if (feature.geometry?.type === "Point") {
    centroid = {
      type: "Feature",
      geometry: feature.geometry,
      properties: {},
    };
  } else if (feature.geometry) {
    try {
      centroid = turf.centerOfMass(feature as any) as GeoJSON.Feature<GeoJSON.Point>;
    } catch {
      centroid = turf.centroid(feature as any) as GeoJSON.Feature<GeoJSON.Point>;
    }
  }

  if (!centroid) return null;

  centroid.properties = {
    ...props,
    traffic_volume_id: props.traffic_volume_id,
    label: tvId,
    tv_kind: props.tv_kind,
    source_geom_type: sourceGeomType,
  };
  return centroid;
}

export function buildTrafficVolumeSources(collection: GeoJSON.FeatureCollection): {
  sectors: GeoJSON.FeatureCollection;
  centroids: GeoJSON.FeatureCollection;
} {
  const features = (collection.features || []).map(normalizeFeature);
  const centroids = features
    .map(buildCentroidFeature)
    .filter(Boolean) as GeoJSON.Feature<GeoJSON.Point>[];

  return {
    sectors: { type: "FeatureCollection", features },
    centroids: { type: "FeatureCollection", features: centroids },
  };
}

export function addTrafficVolumeSources(
  map: maplibregl.Map,
  collection: GeoJSON.FeatureCollection
): { sectors: GeoJSON.FeatureCollection; centroids: GeoJSON.FeatureCollection } {
  const { sectors, centroids } = buildTrafficVolumeSources(collection);
  map.addSource(TRAFFIC_VOLUME_SOURCE_ID, { type: "geojson", data: sectors });
  map.addSource(TRAFFIC_VOLUME_CENTROIDS_SOURCE_ID, { type: "geojson", data: centroids });
  (map as any).__sectors = sectors;
  return { sectors, centroids };
}

export type TrafficVolumeLayerOptions = {
  pointLabelMinZoom?: number;
};

export function addTrafficVolumeLayers(
  map: maplibregl.Map,
  theme: ThemeName,
  options: TrafficVolumeLayerOptions = {}
): void {
  const colors = getTrafficVolumeTheme(theme);
  const pointLabelMinZoom = options.pointLabelMinZoom ?? 24;

  map.addLayer({
    id: TRAFFIC_VOLUME_LAYER_IDS.fill,
    type: "fill",
    source: TRAFFIC_VOLUME_SOURCE_ID,
    paint: { "fill-color": colors.polygonFill, "fill-opacity": 0.04 },
  });
  map.addLayer({
    id: TRAFFIC_VOLUME_LAYER_IDS.outline,
    type: "line",
    source: TRAFFIC_VOLUME_SOURCE_ID,
    paint: { "line-color": colors.polygonOutline, "line-width": 1.5, "line-opacity": 0.12 },
  });

  map.addLayer({
    id: TRAFFIC_VOLUME_LAYER_IDS.point,
    type: "circle",
    source: TRAFFIC_VOLUME_SOURCE_ID,
    filter: NONAS_POINT_FILTER,
    paint: {
      "circle-color": colors.pointFill,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 2.5, 8, 4, 12, 5.5],
      "circle-opacity": 0.9,
      "circle-stroke-color": colors.pointStroke,
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 8, 1, 12, 1.5],
    },
  });

  map.addLayer({
    id: TRAFFIC_VOLUME_LAYER_IDS.label,
    type: "symbol",
    source: TRAFFIC_VOLUME_CENTROIDS_SOURCE_ID,
    filter: POLYGON_ONLY_FILTER,
    layout: {
      "text-field": ["get", "label"],
      "text-size": 12,
      "text-font": ["Noto Sans Regular"],
    },
    paint: {
      "text-color": colors.labelColor,
      "text-halo-color": colors.labelHalo,
      "text-halo-width": 2,
    },
  });

  map.addLayer({
    id: TRAFFIC_VOLUME_LAYER_IDS.pointLabel,
    type: "symbol",
    source: TRAFFIC_VOLUME_CENTROIDS_SOURCE_ID,
    filter: NONAS_POINT_FILTER,
    minzoom: pointLabelMinZoom,
    layout: {
      "text-field": ["get", "label"],
      "text-size": 11,
      "text-font": ["Noto Sans Regular"],
      "text-offset": [0, 1.2],
      "text-anchor": "top",
    },
    paint: {
      "text-color": colors.labelColor,
      "text-halo-color": colors.labelHalo,
      "text-halo-width": 2,
    },
  });

  map.addLayer({
    id: TRAFFIC_VOLUME_LAYER_IDS.pointHoverLabel,
    type: "symbol",
    source: TRAFFIC_VOLUME_CENTROIDS_SOURCE_ID,
    filter: mergeFilters([["==", ["get", "traffic_volume_id"], ""], NONAS_POINT_FILTER]),
    layout: {
      "text-field": ["get", "label"],
      "text-size": 11,
      "text-font": ["Noto Sans Regular"],
      "text-offset": [0, 1.2],
      "text-anchor": "top",
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": colors.labelColor,
      "text-halo-color": colors.labelHalo,
      "text-halo-width": 2,
    },
  });

  map.addLayer({
    id: TRAFFIC_VOLUME_LAYER_IDS.highlight,
    type: "fill",
    source: TRAFFIC_VOLUME_SOURCE_ID,
    paint: { "fill-color": colors.selected, "fill-opacity": 0.3 },
    filter: ["==", ["get", "traffic_volume_id"], ""],
  });
  map.addLayer({
    id: TRAFFIC_VOLUME_LAYER_IDS.highlightOutline,
    type: "line",
    source: TRAFFIC_VOLUME_SOURCE_ID,
    paint: { "line-color": colors.selected, "line-width": 3, "line-opacity": 0.8 },
    filter: ["==", ["get", "traffic_volume_id"], ""],
  });
  map.addLayer({
    id: TRAFFIC_VOLUME_LAYER_IDS.hover,
    type: "fill",
    source: TRAFFIC_VOLUME_SOURCE_ID,
    paint: { "fill-color": colors.hover, "fill-opacity": 0.2 },
    filter: ["==", ["get", "traffic_volume_id"], ""],
  });
  map.addLayer({
    id: TRAFFIC_VOLUME_LAYER_IDS.hoverOutline,
    type: "line",
    source: TRAFFIC_VOLUME_SOURCE_ID,
    paint: { "line-color": colors.hover, "line-width": 2, "line-opacity": 0.6 },
    filter: ["==", ["get", "traffic_volume_id"], ""],
  });
  map.addLayer({
    id: TRAFFIC_VOLUME_LAYER_IDS.hotspot,
    type: "fill",
    source: TRAFFIC_VOLUME_SOURCE_ID,
    paint: { "fill-color": colors.hotspot, "fill-opacity": 0.1 },
    filter: ["==", ["get", "traffic_volume_id"], ""],
  });
  map.addLayer({
    id: TRAFFIC_VOLUME_LAYER_IDS.hotspotOutline,
    type: "line",
    source: TRAFFIC_VOLUME_SOURCE_ID,
    paint: { "line-color": colors.hotspot, "line-width": 3, "line-opacity": 0.9 },
    filter: ["==", ["get", "traffic_volume_id"], ""],
  });

  map.addLayer({
    id: TRAFFIC_VOLUME_LAYER_IDS.pointHighlight,
    type: "circle",
    source: TRAFFIC_VOLUME_SOURCE_ID,
    filter: mergeFilters([["==", ["get", "traffic_volume_id"], ""], NONAS_POINT_FILTER]),
    paint: {
      "circle-color": colors.selected,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4, 8, 6, 12, 8],
      "circle-opacity": 0.9,
      "circle-stroke-color": colors.pointStroke,
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 8, 1.5, 12, 2],
    },
  });
  map.addLayer({
    id: TRAFFIC_VOLUME_LAYER_IDS.pointHover,
    type: "circle",
    source: TRAFFIC_VOLUME_SOURCE_ID,
    filter: mergeFilters([["==", ["get", "traffic_volume_id"], ""], NONAS_POINT_FILTER]),
    paint: {
      "circle-color": colors.hover,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3.5, 8, 5.5, 12, 7],
      "circle-opacity": 0.8,
      "circle-stroke-color": colors.pointStroke,
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 8, 1.5, 12, 2],
    },
  });
  map.addLayer({
    id: TRAFFIC_VOLUME_LAYER_IDS.pointHotspot,
    type: "circle",
    source: TRAFFIC_VOLUME_SOURCE_ID,
    filter: mergeFilters([["==", ["get", "traffic_volume_id"], ""], NONAS_POINT_FILTER]),
    paint: {
      "circle-color": colors.hotspot,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3.5, 8, 5.5, 12, 7],
      "circle-opacity": 0.7,
      "circle-stroke-color": colors.pointStroke,
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 8, 1.5, 12, 2],
    },
  });
}

export function applyTrafficVolumeFilters(
  map: maplibregl.Map,
  filterExpression: any[],
  options: { includeSlack?: boolean } = {}
): void {
  const layerIds = [
    TRAFFIC_VOLUME_LAYER_IDS.fill,
    TRAFFIC_VOLUME_LAYER_IDS.outline,
    TRAFFIC_VOLUME_LAYER_IDS.label,
    TRAFFIC_VOLUME_LAYER_IDS.pointLabel,
    TRAFFIC_VOLUME_LAYER_IDS.point,
  ];
  if (options.includeSlack) {
    layerIds.push("sector-slack");
  }
  for (const layerId of layerIds) {
    if (!map.getLayer(layerId)) continue;
    const baseFilter = getBaseFilterForLayer(layerId);
    const merged = baseFilter ? mergeFilters([baseFilter, filterExpression]) : filterExpression;
    map.setFilter(layerId, merged as any);
  }
}

export function applyTrafficVolumeVisibility(
  map: maplibregl.Map,
  visible: boolean,
  options: { includeSlack?: boolean } = {}
): void {
  const visibility = visible ? "visible" : "none";
  const layerIds = [
    TRAFFIC_VOLUME_LAYER_IDS.fill,
    TRAFFIC_VOLUME_LAYER_IDS.outline,
    TRAFFIC_VOLUME_LAYER_IDS.label,
    TRAFFIC_VOLUME_LAYER_IDS.pointLabel,
    TRAFFIC_VOLUME_LAYER_IDS.pointHoverLabel,
    TRAFFIC_VOLUME_LAYER_IDS.point,
    TRAFFIC_VOLUME_LAYER_IDS.highlight,
    TRAFFIC_VOLUME_LAYER_IDS.highlightOutline,
    TRAFFIC_VOLUME_LAYER_IDS.hover,
    TRAFFIC_VOLUME_LAYER_IDS.hoverOutline,
    TRAFFIC_VOLUME_LAYER_IDS.hotspot,
    TRAFFIC_VOLUME_LAYER_IDS.hotspotOutline,
    TRAFFIC_VOLUME_LAYER_IDS.pointHighlight,
    TRAFFIC_VOLUME_LAYER_IDS.pointHover,
    TRAFFIC_VOLUME_LAYER_IDS.pointHotspot,
  ];
  if (options.includeSlack) {
    layerIds.push("sector-slack");
  }
  for (const layerId of layerIds) {
    if (!map.getLayer(layerId)) continue;
    try {
      map.setLayoutProperty(layerId, "visibility", visibility);
    } catch {
      // no-op
    }
  }
}

function buildTrafficVolumeIdFilter(
  trafficVolumeId: string,
  flLowerBound?: number,
  flUpperBound?: number
): any[] {
  const base = ["==", ["get", "traffic_volume_id"], trafficVolumeId];
  if (flLowerBound == null || flUpperBound == null) return base;
  const flFilter = getTrafficVolumeFlIntersectionFilter(flLowerBound, flUpperBound);
  return ["all", base, ...flFilter.slice(1)];
}

function buildTrafficVolumeIdListFilter(
  trafficVolumeIds: string[],
  flLowerBound?: number,
  flUpperBound?: number
): any[] {
  const base = ["in", ["get", "traffic_volume_id"], ["literal", trafficVolumeIds]];
  if (flLowerBound == null || flUpperBound == null) return base;
  const flFilter = getTrafficVolumeFlIntersectionFilter(flLowerBound, flUpperBound);
  return ["all", base, ...flFilter.slice(1)];
}

export function applyTrafficVolumeHighlight(
  map: maplibregl.Map,
  trafficVolumeId: string | null,
  flLowerBound?: number,
  flUpperBound?: number,
  includeFlRange = false
): void {
  const layers = [
    TRAFFIC_VOLUME_LAYER_IDS.highlight,
    TRAFFIC_VOLUME_LAYER_IDS.highlightOutline,
    TRAFFIC_VOLUME_LAYER_IDS.pointHighlight,
  ];
  const baseIdFilter = trafficVolumeId
    ? buildTrafficVolumeIdFilter(trafficVolumeId, includeFlRange ? flLowerBound : undefined, includeFlRange ? flUpperBound : undefined)
    : ["==", ["get", "traffic_volume_id"], ""];
  for (const layerId of layers) {
    if (!map.getLayer(layerId)) continue;
    const baseFilter = getBaseFilterForLayer(layerId);
    const merged = mergeFilters([baseFilter, baseIdFilter]);
    map.setFilter(layerId, merged as any);
  }
}

export function applyTrafficVolumeHover(
  map: maplibregl.Map,
  trafficVolumeId: string | null,
  flLowerBound?: number,
  flUpperBound?: number,
  includeFlRange = false
): void {
  const layers = [
    TRAFFIC_VOLUME_LAYER_IDS.hover,
    TRAFFIC_VOLUME_LAYER_IDS.hoverOutline,
    TRAFFIC_VOLUME_LAYER_IDS.pointHover,
    TRAFFIC_VOLUME_LAYER_IDS.pointHoverLabel,
  ];
  const baseIdFilter = trafficVolumeId
    ? buildTrafficVolumeIdFilter(trafficVolumeId, includeFlRange ? flLowerBound : undefined, includeFlRange ? flUpperBound : undefined)
    : ["==", ["get", "traffic_volume_id"], ""];
  for (const layerId of layers) {
    if (!map.getLayer(layerId)) continue;
    const baseFilter = getBaseFilterForLayer(layerId);
    const merged = mergeFilters([baseFilter, baseIdFilter]);
    map.setFilter(layerId, merged as any);
  }
}

export function applyTrafficVolumeHotspots(
  map: maplibregl.Map,
  trafficVolumeIds: string[],
  flLowerBound?: number,
  flUpperBound?: number,
  includeFlRange = false
): void {
  const layers = [
    TRAFFIC_VOLUME_LAYER_IDS.hotspot,
    TRAFFIC_VOLUME_LAYER_IDS.hotspotOutline,
    TRAFFIC_VOLUME_LAYER_IDS.pointHotspot,
  ];
  const baseIdFilter = trafficVolumeIds.length > 0
    ? buildTrafficVolumeIdListFilter(trafficVolumeIds, includeFlRange ? flLowerBound : undefined, includeFlRange ? flUpperBound : undefined)
    : ["==", ["get", "traffic_volume_id"], ""];
  for (const layerId of layers) {
    if (!map.getLayer(layerId)) continue;
    const baseFilter = getBaseFilterForLayer(layerId);
    const merged = mergeFilters([baseFilter, baseIdFilter]);
    map.setFilter(layerId, merged as any);
  }
}

export function getTrafficVolumeCenter(geometry: GeoJSON.Geometry | null | undefined): [number, number] | null {
  if (!geometry) return null;
  if (geometry.type === "Point") {
    const [lng, lat] = geometry.coordinates as [number, number];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return [lng, lat];
  }
  try {
    const feature = { type: "Feature", geometry, properties: {} } as GeoJSON.Feature;
    const center = turf.centerOfMass(feature as any) as GeoJSON.Feature<GeoJSON.Point>;
    const coords = center.geometry?.coordinates as [number, number] | undefined;
    if (coords && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) return coords;
  } catch {
    // fall through
  }
  try {
    const feature = { type: "Feature", geometry, properties: {} } as GeoJSON.Feature;
    const center = turf.centroid(feature as any) as GeoJSON.Feature<GeoJSON.Point>;
    const coords = center.geometry?.coordinates as [number, number] | undefined;
    if (coords && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) return coords;
  } catch {
    // no-op
  }
  return null;
}

export function getTrafficVolumeCenterFromMap(
  map: maplibregl.Map,
  trafficVolumeId: string
): [number, number] | null {
  const sectorFeatures = map.querySourceFeatures(TRAFFIC_VOLUME_SOURCE_ID, {
    filter: ["==", "traffic_volume_id", trafficVolumeId],
  });
  if (!sectorFeatures.length) return null;
  return getTrafficVolumeCenter(sectorFeatures[0].geometry as GeoJSON.Geometry);
}
