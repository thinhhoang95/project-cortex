import type { StyleSpecification } from "maplibre-gl";

export function createFuturisticMapStyle(tileSize: number): StyleSpecification {
  return {
    version: 8,
    sources: {
      "raster-tiles": {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize,
        attribution: "© OpenStreetMap contributors"
      },
      countries: {
        type: "vector",
        url: "https://demotiles.maplibre.org/tiles/tiles.json"
      }
    },
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    layers: [
      {
        id: "background",
        type: "background",
        paint: {
          "background-color": "#020617"
        }
      },
      {
        id: "raster-layer",
        type: "raster",
        source: "raster-tiles",
        paint: {
          "raster-opacity": 0.32,
          "raster-brightness-min": 0.05,
          "raster-brightness-max": 0.28,
          "raster-contrast": 0.65,
          "raster-saturation": -0.8,
          "raster-hue-rotate": 200
        }
      },
      {
        id: "countries-fill",
        type: "fill",
        source: "countries",
        "source-layer": "countries",
        paint: {
          "fill-color": "#0b1220",
          "fill-opacity": 0.55
        }
      },
      {
        id: "countries-border-glow",
        type: "line",
        source: "countries",
        "source-layer": "countries",
        paint: {
          "line-color": "#0ea5e9",
          "line-width": 4,
          "line-opacity": 0.08
        }
      },
      {
        id: "countries-border",
        type: "line",
        source: "countries",
        "source-layer": "countries",
        paint: {
          "line-color": "#38bdf8",
          "line-width": 1.2,
          "line-opacity": 0.6
        }
      }
    ]
  } satisfies StyleSpecification;
}
