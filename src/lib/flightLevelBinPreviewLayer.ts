import type maplibregl from "maplibre-gl";

import type { FlightLevelBinPreviewSegment } from "@/lib/flightLevelBinCounts";
import {
  FLIGHT_LINE_LABELS_CALLSIGN_LAYER_ID,
  type FlightLineLabelMode,
} from "@/lib/flightLineLabels";

export const FLIGHT_LEVEL_BIN_PREVIEW_SOURCE_ID = "flight-level-bin-preview-source";
export const FLIGHT_LEVEL_BIN_PREVIEW_LINE_LAYER_ID = "flight-level-bin-preview-line";
export const FLIGHT_LEVEL_BIN_PREVIEW_LABEL_LAYER_ID = "flight-level-bin-preview-label";

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export function buildFlightLevelBinPreviewFeatureCollection(
  segments: FlightLevelBinPreviewSegment[],
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: segments.map((segment) => ({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: segment.coordinates,
      },
      properties: {
        previewSegmentId: segment.previewSegmentId,
        flightId: segment.flightId,
        flightLevelLabel: segment.flightLevelLabel,
      },
    })),
  };
}

function ensureFlightLevelBinPreviewLayers(map: maplibregl.Map): void {
  if (!map.getSource(FLIGHT_LEVEL_BIN_PREVIEW_SOURCE_ID)) {
    map.addSource(FLIGHT_LEVEL_BIN_PREVIEW_SOURCE_ID, {
      type: "geojson",
      data: emptyFeatureCollection(),
    });
  }

  const beforeId = map.getLayer(FLIGHT_LINE_LABELS_CALLSIGN_LAYER_ID)
    ? FLIGHT_LINE_LABELS_CALLSIGN_LAYER_ID
    : undefined;

  if (!map.getLayer(FLIGHT_LEVEL_BIN_PREVIEW_LINE_LAYER_ID)) {
    map.addLayer(
      {
        id: FLIGHT_LEVEL_BIN_PREVIEW_LINE_LAYER_ID,
        type: "line",
        source: FLIGHT_LEVEL_BIN_PREVIEW_SOURCE_ID,
        layout: {
          visibility: "none",
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#67e8f9",
          "line-width": 2.5,
          "line-opacity": 0,
        },
      },
      beforeId,
    );
  }

  if (!map.getLayer(FLIGHT_LEVEL_BIN_PREVIEW_LABEL_LAYER_ID)) {
    map.addLayer(
      {
        id: FLIGHT_LEVEL_BIN_PREVIEW_LABEL_LAYER_ID,
        type: "symbol",
        source: FLIGHT_LEVEL_BIN_PREVIEW_SOURCE_ID,
        layout: {
          visibility: "none",
          "symbol-placement": "line",
          "text-field": ["get", "flightLevelLabel"],
          "text-size": 11,
          "text-font": ["Noto Sans Regular"],
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#67e8f9",
          "text-halo-color": "#0f172a",
          "text-halo-width": 0,
          "text-opacity": 0,
        },
      },
      beforeId,
    );
  }
}

export function syncFlightLevelBinPreviewLayer(params: {
  map: maplibregl.Map;
  segments: FlightLevelBinPreviewSegment[];
  showFlightLineLabels: boolean;
  flightLineLabelMode: FlightLineLabelMode;
}): void {
  const { map, segments, showFlightLineLabels, flightLineLabelMode } = params;
  ensureFlightLevelBinPreviewLayers(map);

  const source = map.getSource(FLIGHT_LEVEL_BIN_PREVIEW_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(buildFlightLevelBinPreviewFeatureCollection(segments));
  }

  const hasSegments = segments.length > 0;
  const showLabels = hasSegments && showFlightLineLabels && flightLineLabelMode === "flightLevel";

  if (map.getLayer(FLIGHT_LEVEL_BIN_PREVIEW_LINE_LAYER_ID)) {
    map.setLayoutProperty(
      FLIGHT_LEVEL_BIN_PREVIEW_LINE_LAYER_ID,
      "visibility",
      hasSegments ? "visible" : "none",
    );
    map.setPaintProperty(
      FLIGHT_LEVEL_BIN_PREVIEW_LINE_LAYER_ID,
      "line-opacity",
      hasSegments ? 0.85 : 0,
    );
  }

  if (map.getLayer(FLIGHT_LEVEL_BIN_PREVIEW_LABEL_LAYER_ID)) {
    map.setLayoutProperty(
      FLIGHT_LEVEL_BIN_PREVIEW_LABEL_LAYER_ID,
      "visibility",
      hasSegments ? "visible" : "none",
    );
    map.setPaintProperty(
      FLIGHT_LEVEL_BIN_PREVIEW_LABEL_LAYER_ID,
      "text-opacity",
      showLabels ? 1 : 0,
    );
    map.setPaintProperty(
      FLIGHT_LEVEL_BIN_PREVIEW_LABEL_LAYER_ID,
      "text-halo-width",
      showLabels ? 2 : 0,
    );
  }
}
