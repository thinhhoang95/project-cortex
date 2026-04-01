import type maplibregl from "maplibre-gl";

export const COMPLEXITY_CONTEXT_SOURCE_ID = "complexity-context-bands";
export const COMPLEXITY_CONTEXT_FILL_LAYER_ID = "complexity-context-band-fill";
export const COMPLEXITY_CONTEXT_OUTLINE_LAYER_ID = "complexity-context-band-outline";

function emptyPolygonCollection(): GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon> {
  return { type: "FeatureCollection", features: [] };
}

function ensureComplexityContextLayers(map: maplibregl.Map): void {
  const beforeId = map.getLayer("flight-lines") ? "flight-lines" : undefined;
  if (!map.getSource(COMPLEXITY_CONTEXT_SOURCE_ID)) {
    map.addSource(COMPLEXITY_CONTEXT_SOURCE_ID, {
      type: "geojson",
      data: emptyPolygonCollection(),
    });
  }

  if (!map.getLayer(COMPLEXITY_CONTEXT_FILL_LAYER_ID)) {
    map.addLayer(
      {
        id: COMPLEXITY_CONTEXT_FILL_LAYER_ID,
        type: "fill",
        source: COMPLEXITY_CONTEXT_SOURCE_ID,
        layout: { visibility: "none" },
        paint: {
          "fill-color": ["coalesce", ["get", "fillColor"], "#facc15"],
          "fill-opacity": 0,
        },
      },
      beforeId,
    );
  }

  if (!map.getLayer(COMPLEXITY_CONTEXT_OUTLINE_LAYER_ID)) {
    map.addLayer(
      {
        id: COMPLEXITY_CONTEXT_OUTLINE_LAYER_ID,
        type: "line",
        source: COMPLEXITY_CONTEXT_SOURCE_ID,
        layout: { visibility: "none" },
        paint: {
          "line-color": ["coalesce", ["get", "lineColor"], "#f97316"],
          "line-width": 1.2,
          "line-opacity": 0,
        },
      },
      beforeId,
    );
  }
}

function setGeoJsonSourceData(
  map: maplibregl.Map,
  data: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
): void {
  const source = map.getSource(COMPLEXITY_CONTEXT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  source.setData(data);
}

export function clearComplexityContextLayers(map: maplibregl.Map | null): void {
  if (!map) return;
  setGeoJsonSourceData(map, emptyPolygonCollection());
  if (map.getLayer(COMPLEXITY_CONTEXT_FILL_LAYER_ID)) {
    map.setLayoutProperty(COMPLEXITY_CONTEXT_FILL_LAYER_ID, "visibility", "none");
    map.setPaintProperty(COMPLEXITY_CONTEXT_FILL_LAYER_ID, "fill-opacity", 0);
  }
  if (map.getLayer(COMPLEXITY_CONTEXT_OUTLINE_LAYER_ID)) {
    map.setLayoutProperty(COMPLEXITY_CONTEXT_OUTLINE_LAYER_ID, "visibility", "none");
    map.setPaintProperty(COMPLEXITY_CONTEXT_OUTLINE_LAYER_ID, "line-opacity", 0);
  }
}

export function syncComplexityContextLayers(
  map: maplibregl.Map,
  overlay: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
): void {
  ensureComplexityContextLayers(map);
  setGeoJsonSourceData(map, overlay);

  const hasFeatures = overlay.features.length > 0;
  if (map.getLayer(COMPLEXITY_CONTEXT_FILL_LAYER_ID)) {
    map.setLayoutProperty(COMPLEXITY_CONTEXT_FILL_LAYER_ID, "visibility", hasFeatures ? "visible" : "none");
    map.setPaintProperty(
      COMPLEXITY_CONTEXT_FILL_LAYER_ID,
      "fill-opacity",
      hasFeatures ? ["coalesce", ["get", "fillOpacity"], 0.18] : 0,
    );
  }
  if (map.getLayer(COMPLEXITY_CONTEXT_OUTLINE_LAYER_ID)) {
    map.setLayoutProperty(
      COMPLEXITY_CONTEXT_OUTLINE_LAYER_ID,
      "visibility",
      hasFeatures ? "visible" : "none",
    );
    map.setPaintProperty(
      COMPLEXITY_CONTEXT_OUTLINE_LAYER_ID,
      "line-opacity",
      hasFeatures ? ["coalesce", ["get", "lineOpacity"], 0.24] : 0,
    );
  }
}
