import { describe, expect, it } from "vitest";

import { buildFlightLevelBinPreviewFeatureCollection } from "./flightLevelBinPreviewLayer";

describe("flightLevelBinPreviewLayer", () => {
  it("builds one display feature per exact preview segment", () => {
    const collection = buildFlightLevelBinPreviewFeatureCollection([
      {
        previewSegmentId: "F1:3000000:4200000:0",
        flightId: "F1",
        coordinates: [[4.5, 50.8], [4.7, 50.9], [4.9, 51]],
        flightLevelLabel: "330-360",
      },
      {
        previewSegmentId: "F3:3480000:3720000:0",
        flightId: "F3",
        coordinates: [[5.0, 50.4], [5.1, 50.5]],
        flightLevelLabel: "330-360",
      },
    ]);

    expect(collection.features).toHaveLength(2);
    expect(collection.features[0]?.properties).toMatchObject({
      previewSegmentId: "F1:3000000:4200000:0",
      flightId: "F1",
      flightLevelLabel: "330-360",
    });
    expect(collection.features[0]?.geometry).toEqual({
      type: "LineString",
      coordinates: [[4.5, 50.8], [4.7, 50.9], [4.9, 51]],
    });
  });
});
