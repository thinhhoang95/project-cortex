import type maplibregl from "maplibre-gl";

import {
  createEmptyComplexityOverlayCollections,
  type ComplexityOverlayCollections,
} from "@/lib/csComplexity";
import { FLIGHT_LINE_LABELS_CALLSIGN_LAYER_ID } from "@/lib/flightLineLabels";

export const COMPLEXITY_TRACE_LINE_SOURCE_ID = "complexity-trace-lines";
export const COMPLEXITY_TRACE_POINT_SOURCE_ID = "complexity-trace-points";
export const COMPLEXITY_TRACE_LABEL_SOURCE_ID = "complexity-trace-labels";

export const COMPLEXITY_TRACE_LINE_LAYER_ID = "complexity-trace-line-layer";
export const COMPLEXITY_TRACE_POINT_LAYER_ID = "complexity-trace-point-layer";
export const COMPLEXITY_TRACE_ARROW_LAYER_ID = "complexity-trace-arrow-layer";
export const COMPLEXITY_TRACE_LABEL_LAYER_ID = "complexity-trace-label-layer";

function ensureComplexityTraceLayers(map: maplibregl.Map): void {
  const beforeId = map.getLayer(FLIGHT_LINE_LABELS_CALLSIGN_LAYER_ID)
    ? FLIGHT_LINE_LABELS_CALLSIGN_LAYER_ID
    : undefined;
  const emptyCollections = createEmptyComplexityOverlayCollections();

  if (!map.getSource(COMPLEXITY_TRACE_LINE_SOURCE_ID)) {
    map.addSource(COMPLEXITY_TRACE_LINE_SOURCE_ID, {
      type: "geojson",
      data: emptyCollections.lines,
    });
  }

  if (!map.getSource(COMPLEXITY_TRACE_POINT_SOURCE_ID)) {
    map.addSource(COMPLEXITY_TRACE_POINT_SOURCE_ID, {
      type: "geojson",
      data: emptyCollections.points,
    });
  }

  if (!map.getSource(COMPLEXITY_TRACE_LABEL_SOURCE_ID)) {
    map.addSource(COMPLEXITY_TRACE_LABEL_SOURCE_ID, {
      type: "geojson",
      data: emptyCollections.labels,
    });
  }

  if (!map.getLayer(COMPLEXITY_TRACE_LINE_LAYER_ID)) {
    map.addLayer(
      {
        id: COMPLEXITY_TRACE_LINE_LAYER_ID,
        type: "line",
        source: COMPLEXITY_TRACE_LINE_SOURCE_ID,
        layout: {
          visibility: "none",
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": ["coalesce", ["get", "color"], "#38bdf8"],
          "line-width": ["coalesce", ["get", "lineWidth"], 2],
          "line-opacity": 0,
        },
      },
      beforeId,
    );
  }

  if (!map.getLayer(COMPLEXITY_TRACE_POINT_LAYER_ID)) {
    map.addLayer(
      {
        id: COMPLEXITY_TRACE_POINT_LAYER_ID,
        type: "circle",
        source: COMPLEXITY_TRACE_POINT_SOURCE_ID,
        layout: { visibility: "none" },
        paint: {
          "circle-color": ["coalesce", ["get", "color"], "#38bdf8"],
          "circle-radius": ["coalesce", ["get", "pointRadius"], 4],
          "circle-opacity": 0,
          "circle-stroke-color": "#0f172a",
          "circle-stroke-width": 1,
        },
      },
      beforeId,
    );
  }

  if (!map.getLayer(COMPLEXITY_TRACE_ARROW_LAYER_ID)) {
    map.addLayer(
      {
        id: COMPLEXITY_TRACE_ARROW_LAYER_ID,
        type: "symbol",
        source: COMPLEXITY_TRACE_LABEL_SOURCE_ID,
        filter: ["==", ["get", "kind"], "arrow"],
        layout: {
          visibility: "none",
          "text-field": ["coalesce", ["get", "labelText"], ""],
          "text-size": ["coalesce", ["get", "labelSize"], 14],
          "text-font": ["Noto Sans Regular"],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "text-rotate": ["coalesce", ["get", "labelRotate"], 0],
          "text-rotation-alignment": "map",
        },
        paint: {
          "text-color": ["coalesce", ["get", "color"], "#38bdf8"],
          "text-halo-color": "#0f172a",
          "text-halo-width": 0,
          "text-opacity": 0,
        },
      },
      beforeId,
    );
  }

  if (!map.getLayer(COMPLEXITY_TRACE_LABEL_LAYER_ID)) {
    map.addLayer(
      {
        id: COMPLEXITY_TRACE_LABEL_LAYER_ID,
        type: "symbol",
        source: COMPLEXITY_TRACE_LABEL_SOURCE_ID,
        filter: ["!=", ["get", "kind"], "arrow"],
        layout: {
          visibility: "none",
          "text-field": ["coalesce", ["get", "labelText"], ""],
          "text-size": ["coalesce", ["get", "labelSize"], 11],
          "text-font": ["Noto Sans Regular"],
          "text-offset": [0, -1.1],
          "text-anchor": "top",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": ["coalesce", ["get", "color"], "#38bdf8"],
          "text-halo-color": "#0f172a",
          "text-halo-width": 0,
          "text-opacity": 0,
        },
      },
      beforeId,
    );
  }
}

function setGeoJsonSourceData(
  map: maplibregl.Map,
  sourceId: string,
  data: GeoJSON.FeatureCollection,
): void {
  const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  source.setData(data);
}

export function clearComplexityTraceLayers(map: maplibregl.Map | null): void {
  if (!map) return;
  const emptyCollections = createEmptyComplexityOverlayCollections();
  setGeoJsonSourceData(map, COMPLEXITY_TRACE_LINE_SOURCE_ID, emptyCollections.lines);
  setGeoJsonSourceData(map, COMPLEXITY_TRACE_POINT_SOURCE_ID, emptyCollections.points);
  setGeoJsonSourceData(map, COMPLEXITY_TRACE_LABEL_SOURCE_ID, emptyCollections.labels);

  if (map.getLayer(COMPLEXITY_TRACE_LINE_LAYER_ID)) {
    map.setLayoutProperty(COMPLEXITY_TRACE_LINE_LAYER_ID, "visibility", "none");
    map.setPaintProperty(COMPLEXITY_TRACE_LINE_LAYER_ID, "line-opacity", 0);
  }
  if (map.getLayer(COMPLEXITY_TRACE_POINT_LAYER_ID)) {
    map.setLayoutProperty(COMPLEXITY_TRACE_POINT_LAYER_ID, "visibility", "none");
    map.setPaintProperty(COMPLEXITY_TRACE_POINT_LAYER_ID, "circle-opacity", 0);
  }
  if (map.getLayer(COMPLEXITY_TRACE_ARROW_LAYER_ID)) {
    map.setLayoutProperty(COMPLEXITY_TRACE_ARROW_LAYER_ID, "visibility", "none");
    map.setPaintProperty(COMPLEXITY_TRACE_ARROW_LAYER_ID, "text-opacity", 0);
  }
  if (map.getLayer(COMPLEXITY_TRACE_LABEL_LAYER_ID)) {
    map.setLayoutProperty(COMPLEXITY_TRACE_LABEL_LAYER_ID, "visibility", "none");
    map.setPaintProperty(COMPLEXITY_TRACE_LABEL_LAYER_ID, "text-opacity", 0);
    map.setPaintProperty(COMPLEXITY_TRACE_LABEL_LAYER_ID, "text-halo-width", 0);
  }
}

export function syncComplexityTraceLayers(
  map: maplibregl.Map,
  overlay: ComplexityOverlayCollections,
): void {
  ensureComplexityTraceLayers(map);

  setGeoJsonSourceData(map, COMPLEXITY_TRACE_LINE_SOURCE_ID, overlay.lines);
  setGeoJsonSourceData(map, COMPLEXITY_TRACE_POINT_SOURCE_ID, overlay.points);
  setGeoJsonSourceData(map, COMPLEXITY_TRACE_LABEL_SOURCE_ID, overlay.labels);

  const hasLines = overlay.lines.features.length > 0;
  const hasPoints = overlay.points.features.length > 0;
  const hasArrowLabels = overlay.labels.features.some(
    (feature) => feature?.properties?.kind === "arrow",
  );
  const hasTextLabels = overlay.labels.features.some(
    (feature) => feature?.properties?.kind !== "arrow",
  );

  if (map.getLayer(COMPLEXITY_TRACE_LINE_LAYER_ID)) {
    map.setLayoutProperty(COMPLEXITY_TRACE_LINE_LAYER_ID, "visibility", hasLines ? "visible" : "none");
    map.setPaintProperty(COMPLEXITY_TRACE_LINE_LAYER_ID, "line-opacity", hasLines ? 0.92 : 0);
  }
  if (map.getLayer(COMPLEXITY_TRACE_POINT_LAYER_ID)) {
    map.setLayoutProperty(COMPLEXITY_TRACE_POINT_LAYER_ID, "visibility", hasPoints ? "visible" : "none");
    map.setPaintProperty(COMPLEXITY_TRACE_POINT_LAYER_ID, "circle-opacity", hasPoints ? 0.9 : 0);
  }
  if (map.getLayer(COMPLEXITY_TRACE_ARROW_LAYER_ID)) {
    map.setLayoutProperty(COMPLEXITY_TRACE_ARROW_LAYER_ID, "visibility", hasArrowLabels ? "visible" : "none");
    map.setPaintProperty(COMPLEXITY_TRACE_ARROW_LAYER_ID, "text-opacity", hasArrowLabels ? 1 : 0);
  }
  if (map.getLayer(COMPLEXITY_TRACE_LABEL_LAYER_ID)) {
    map.setLayoutProperty(COMPLEXITY_TRACE_LABEL_LAYER_ID, "visibility", hasTextLabels ? "visible" : "none");
    map.setPaintProperty(COMPLEXITY_TRACE_LABEL_LAYER_ID, "text-opacity", hasTextLabels ? 1 : 0);
    map.setPaintProperty(COMPLEXITY_TRACE_LABEL_LAYER_ID, "text-halo-width", hasTextLabels ? 2 : 0);
  }
}
