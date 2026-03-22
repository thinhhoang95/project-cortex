import type maplibregl from "maplibre-gl";

import type { Trajectory } from "@/lib/models";
import {
  applyFlightLineLabelVisibility,
  FLIGHT_LINE_LABELS_CALLSIGN_LAYER_ID,
  FLIGHT_LINE_LABELS_FLIGHT_LEVEL_LAYER_ID,
  FLIGHT_LINE_LABELS_FLIGHT_LEVEL_SOURCE_ID,
  type FlightLineLabelMode,
} from "@/lib/flightLineLabels";
import { buildTrajectoryFlightLevelLabelFeatureCollection } from "@/lib/trajectoryRender";

type FlightLineLabelLayerCache = {
  tracksRef: Trajectory[] | undefined;
  visibleFlightIds: string[];
};

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function areStringArraysEqual(a: string[] | undefined, b: string[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function ensureFlightLevelLabelLayer(map: maplibregl.Map): void {
  if (!map.getSource(FLIGHT_LINE_LABELS_FLIGHT_LEVEL_SOURCE_ID)) {
    map.addSource(FLIGHT_LINE_LABELS_FLIGHT_LEVEL_SOURCE_ID, {
      type: "geojson",
      data: emptyFeatureCollection(),
    });
  }

  if (!map.getLayer(FLIGHT_LINE_LABELS_FLIGHT_LEVEL_LAYER_ID)) {
    const beforeId = map.getLayer(FLIGHT_LINE_LABELS_CALLSIGN_LAYER_ID)
      ? FLIGHT_LINE_LABELS_CALLSIGN_LAYER_ID
      : undefined;
    map.addLayer(
      {
        id: FLIGHT_LINE_LABELS_FLIGHT_LEVEL_LAYER_ID,
        type: "symbol",
        source: FLIGHT_LINE_LABELS_FLIGHT_LEVEL_SOURCE_ID,
        layout: {
          "symbol-placement": "line",
          "text-field": ["get", "flightLevelLabel"],
          "text-size": 11,
          "text-font": ["Noto Sans Regular"],
        },
        paint: { "text-color": "#34d399", "text-halo-color": "#0f172a", "text-halo-width": 2 },
      },
      beforeId,
    );
  }
}

export function removeFlightLevelLabelLayer(map: maplibregl.Map): void {
  if (map.getLayer(FLIGHT_LINE_LABELS_FLIGHT_LEVEL_LAYER_ID)) {
    map.removeLayer(FLIGHT_LINE_LABELS_FLIGHT_LEVEL_LAYER_ID);
  }
  if (map.getSource(FLIGHT_LINE_LABELS_FLIGHT_LEVEL_SOURCE_ID)) {
    map.removeSource(FLIGHT_LINE_LABELS_FLIGHT_LEVEL_SOURCE_ID);
  }
  delete (map as any).__flightLevelLabelLayerCache;
}

export function syncFlightLevelLabelLayer(params: {
  map: maplibregl.Map;
  tracks: Trajectory[] | undefined;
  visibleFlightIds: string[];
  showFlightLineLabels: boolean;
  flightLineLabelMode: FlightLineLabelMode;
}): void {
  const { map, tracks, visibleFlightIds, showFlightLineLabels, flightLineLabelMode } = params;
  const enabled = showFlightLineLabels && flightLineLabelMode === "flightLevel";

  if (!enabled || !tracks || visibleFlightIds.length === 0) {
    removeFlightLevelLabelLayer(map);
    applyFlightLineLabelVisibility(map, showFlightLineLabels, flightLineLabelMode);
    return;
  }

  ensureFlightLevelLabelLayer(map);

  const cache = (map as any).__flightLevelLabelLayerCache as FlightLineLabelLayerCache | undefined;
  if (cache?.tracksRef === tracks && areStringArraysEqual(cache.visibleFlightIds, visibleFlightIds)) {
    applyFlightLineLabelVisibility(map, showFlightLineLabels, flightLineLabelMode);
    return;
  }

  const visibleFlightIdSet = new Set(visibleFlightIds);
  const visibleTracks: Trajectory[] = [];
  for (const track of tracks) {
    const flightId = String(track?.flightId ?? "").trim();
    if (flightId && visibleFlightIdSet.has(flightId)) {
      visibleTracks.push(track);
    }
  }

  const source = map.getSource(FLIGHT_LINE_LABELS_FLIGHT_LEVEL_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(buildTrajectoryFlightLevelLabelFeatureCollection(visibleTracks));
  }

  (map as any).__flightLevelLabelLayerCache = {
    tracksRef: tracks,
    visibleFlightIds: visibleFlightIds.slice(),
  } satisfies FlightLineLabelLayerCache;

  applyFlightLineLabelVisibility(map, showFlightLineLabels, flightLineLabelMode);
}
