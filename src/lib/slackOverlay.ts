import type maplibregl from "maplibre-gl";

export const SLACK_LAYER_ID = "sector-slack";

export type SlackMode = "off" | "minus" | "plus";

type SlackEligibilityState = {
  airspaceDisplayMode: "tv" | "es";
  selectedTrafficVolume: string | null;
  selectedTrafficVolumes: string[];
};

type SlackVisibilityState = {
  showTrafficVolumes: boolean;
  slackEligible: boolean;
  slackMode: SlackMode;
};

export function getSlackSourceTrafficVolumeId({
  airspaceDisplayMode,
  selectedTrafficVolume,
  selectedTrafficVolumes,
}: SlackEligibilityState): string | null {
  if (airspaceDisplayMode !== "tv") return null;
  const selectedIds =
    Array.isArray(selectedTrafficVolumes) && selectedTrafficVolumes.length > 0
      ? selectedTrafficVolumes
      : selectedTrafficVolume
        ? [selectedTrafficVolume]
        : [];
  if (selectedIds.length !== 1) return null;
  const trafficVolumeId = String(selectedIds[0] ?? "").trim();
  return trafficVolumeId || null;
}

export function isSlackOverlayEligible(state: SlackEligibilityState): boolean {
  return getSlackSourceTrafficVolumeId(state) !== null;
}

export function shouldShowSlackOverlay({
  showTrafficVolumes,
  slackEligible,
  slackMode,
}: SlackVisibilityState): boolean {
  return showTrafficVolumes && slackEligible && slackMode !== "off";
}

export function setSlackOverlayVisibility(
  map: maplibregl.Map,
  visible: boolean,
): void {
  if (!map || !map.isStyleLoaded() || !map.getLayer(SLACK_LAYER_ID)) return;
  map.setLayoutProperty(SLACK_LAYER_ID, "visibility", visible ? "visible" : "none");
}

export function syncSlackOverlayVisibility(
  map: maplibregl.Map,
  state: SlackVisibilityState,
): void {
  setSlackOverlayVisibility(map, shouldShowSlackOverlay(state));
}
