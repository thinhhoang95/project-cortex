import type { Trajectory } from "@/lib/models";
import { getFlightLevelLabelFromAltitudeFeet } from "@/lib/flightLineLabels";

function getTrajectoryLineColor(trajectory: Trajectory): string {
  const firstCoord = trajectory.coords[0];
  const lastCoord = trajectory.coords[trajectory.coords.length - 1];
  if (!firstCoord || !lastCoord) return "#10b981";

  const deltaLon = lastCoord[0] - firstCoord[0];
  const deltaLat = lastCoord[1] - firstCoord[1];
  const absLonChange = Math.abs(deltaLon);
  const absLatChange = Math.abs(deltaLat);

  if (absLonChange > absLatChange) {
    return deltaLon < 0 ? "#ec4899" : "#10b981";
  }
  return deltaLat > 0 ? "#ec4899" : "#10b981";
}

export function buildTrajectoryLineFeatureCollection(
  trajectories: Trajectory[],
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: trajectories.map((trajectory) => ({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: trajectory.coords.map((coord) => [coord[0], coord[1]]),
      },
      properties: {
        flightId: trajectory.flightId,
        callSign: trajectory.callSign ?? trajectory.flightId,
        lineColor: getTrajectoryLineColor(trajectory),
      },
    })),
  };
}

export function buildTrajectoryFlightLevelLabelFeatureCollection(
  trajectories: Trajectory[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const trajectory of trajectories) {
    if (!Array.isArray(trajectory.coords) || trajectory.coords.length < 2) {
      continue;
    }

    for (let index = 0; index < trajectory.coords.length - 1; index += 1) {
      const coord = trajectory.coords[index];
      const nextCoord = trajectory.coords[index + 1];
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [coord[0], coord[1]],
            [nextCoord[0], nextCoord[1]],
          ],
        },
        properties: {
          flightId: trajectory.flightId,
          flightLevelLabel: getFlightLevelLabelFromAltitudeFeet(coord[2], nextCoord[2]),
        },
      });
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
}
