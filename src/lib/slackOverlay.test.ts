import { describe, expect, it, vi } from "vitest";

import {
  getSlackSourceTrafficVolumeId,
  shouldShowSlackOverlay,
  SLACK_LAYER_ID,
  syncSlackOverlayVisibility,
} from "./slackOverlay";

describe("Slack overlay visibility", () => {
  it("stays hidden when traffic volumes are restored while Slack View is off", () => {
    const setLayoutProperty = vi.fn();
    const map = {
      isStyleLoaded: () => true,
      getLayer: (layerId: string) => layerId === SLACK_LAYER_ID,
      setLayoutProperty,
    };

    syncSlackOverlayVisibility(map as any, {
      showTrafficVolumes: false,
      slackEligible: true,
      slackMode: "off",
    });
    syncSlackOverlayVisibility(map as any, {
      showTrafficVolumes: true,
      slackEligible: true,
      slackMode: "off",
    });

    expect(setLayoutProperty).toHaveBeenLastCalledWith(
      SLACK_LAYER_ID,
      "visibility",
      "none",
    );
  });

  it("requires traffic visibility, eligibility, and an active Slack mode", () => {
    expect(
      shouldShowSlackOverlay({
        showTrafficVolumes: true,
        slackEligible: true,
        slackMode: "minus",
      }),
    ).toBe(true);
    expect(
      shouldShowSlackOverlay({
        showTrafficVolumes: true,
        slackEligible: true,
        slackMode: "off",
      }),
    ).toBe(false);
    expect(
      shouldShowSlackOverlay({
        showTrafficVolumes: false,
        slackEligible: true,
        slackMode: "plus",
      }),
    ).toBe(false);
  });

  it("uses the grouped selection as the canonical eligibility source", () => {
    expect(
      getSlackSourceTrafficVolumeId({
        airspaceDisplayMode: "tv",
        selectedTrafficVolume: "legacy",
        selectedTrafficVolumes: ["TV1"],
      }),
    ).toBe("TV1");
    expect(
      getSlackSourceTrafficVolumeId({
        airspaceDisplayMode: "tv",
        selectedTrafficVolume: "legacy",
        selectedTrafficVolumes: ["TV1", "TV2"],
      }),
    ).toBeNull();
    expect(
      getSlackSourceTrafficVolumeId({
        airspaceDisplayMode: "es",
        selectedTrafficVolume: "TV1",
        selectedTrafficVolumes: ["TV1"],
      }),
    ).toBeNull();
  });
});
