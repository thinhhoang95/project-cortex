import type maplibregl from "maplibre-gl";

export type FlightLineLabelMode = "callsign" | "flightLevel";

export const FLIGHT_LINE_LABELS_CALLSIGN_LAYER_ID = "flight-line-labels";
export const FLIGHT_LINE_LABELS_FLIGHT_LEVEL_SOURCE_ID = "flight-line-labels-flight-level-source";
export const FLIGHT_LINE_LABELS_FLIGHT_LEVEL_LAYER_ID = "flight-line-labels-flight-level";

function getTextOpacity(showFlightLineLabels: boolean, active: boolean): number {
  return showFlightLineLabels && active ? 1 : 0;
}

function getHaloWidth(showFlightLineLabels: boolean, active: boolean): number {
  return showFlightLineLabels && active ? 2 : 0;
}

export function applyFlightLineLabelVisibility(
  map: maplibregl.Map,
  showFlightLineLabels: boolean,
  flightLineLabelMode: FlightLineLabelMode,
): void {
  const showCallsigns = flightLineLabelMode === "callsign";
  const showFlightLevels = flightLineLabelMode === "flightLevel";

  if (map.getLayer(FLIGHT_LINE_LABELS_CALLSIGN_LAYER_ID)) {
    map.setPaintProperty(
      FLIGHT_LINE_LABELS_CALLSIGN_LAYER_ID,
      "text-opacity",
      getTextOpacity(showFlightLineLabels, showCallsigns),
    );
    map.setPaintProperty(
      FLIGHT_LINE_LABELS_CALLSIGN_LAYER_ID,
      "text-halo-width",
      getHaloWidth(showFlightLineLabels, showCallsigns),
    );
  }

  if (map.getLayer(FLIGHT_LINE_LABELS_FLIGHT_LEVEL_LAYER_ID)) {
    map.setPaintProperty(
      FLIGHT_LINE_LABELS_FLIGHT_LEVEL_LAYER_ID,
      "text-opacity",
      getTextOpacity(showFlightLineLabels, showFlightLevels),
    );
    map.setPaintProperty(
      FLIGHT_LINE_LABELS_FLIGHT_LEVEL_LAYER_ID,
      "text-halo-width",
      getHaloWidth(showFlightLineLabels, showFlightLevels),
    );
  }
}

export function setFlightLineLabelFilters(map: maplibregl.Map, filterExpr: unknown): void {
  if (map.getLayer(FLIGHT_LINE_LABELS_CALLSIGN_LAYER_ID)) {
    map.setFilter(FLIGHT_LINE_LABELS_CALLSIGN_LAYER_ID, filterExpr as any);
  }
  if (map.getLayer(FLIGHT_LINE_LABELS_FLIGHT_LEVEL_LAYER_ID)) {
    map.setFilter(FLIGHT_LINE_LABELS_FLIGHT_LEVEL_LAYER_ID, filterExpr as any);
  }
}

export function getFlightLevelLabelFromAltitudeFeet(
  altitudeStartFt?: number,
  altitudeEndFt?: number,
): string {
  const startFt = Number.isFinite(altitudeStartFt) ? Number(altitudeStartFt) : null;
  const endFt = Number.isFinite(altitudeEndFt) ? Number(altitudeEndFt) : null;

  let representativeAltitudeFt = 0;
  if (startFt !== null && endFt !== null) {
    representativeAltitudeFt = (startFt + endFt) / 2;
  } else if (startFt !== null) {
    representativeAltitudeFt = startFt;
  } else if (endFt !== null) {
    representativeAltitudeFt = endFt;
  }

  const flightLevel = Math.max(0, Math.round(representativeAltitudeFt / 100));
  return String(flightLevel);
}

export function resolveFlightLineLabelSelection(
  currentMode: FlightLineLabelMode,
  showFlightLineLabels: boolean,
  selectedMode: FlightLineLabelMode,
): { nextMode: FlightLineLabelMode; nextShowFlightLineLabels: boolean } {
  if (selectedMode !== currentMode) {
    return {
      nextMode: selectedMode,
      nextShowFlightLineLabels: true,
    };
  }

  return {
    nextMode: currentMode,
    nextShowFlightLineLabels: !showFlightLineLabels,
  };
}
