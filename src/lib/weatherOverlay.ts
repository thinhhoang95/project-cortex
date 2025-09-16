import maplibregl from "maplibre-gl";

export const SURFACE_PRECIP_LAYER_ID = "era5_tp";

const LAYER_ORDER_PREFERENCE = [
  "sector-fill",
  "sector-outline",
  "sector-labels",
  "sector-highlight",
  "sector-highlight-outline",
  "sector-hover",
  "sector-hover-outline",
  "sector-hotspot",
  "sector-hotspot-outline",
  "flight-lines"
];

const TITILER_BASE = "https://wxtiles.tailwind-api.intuelle.com";
const COG_BASE = `${TITILER_BASE}/cogs`;

export function isoHourFrom(dateStr: string, t: number): string {
  const [ddStr, mmStr, yyyyStr] = String(dateStr || "").split("/") as [string, string, string];
  const dd = Number(ddStr || "1");
  const mm = Number(mmStr || "1");
  const yyyy = Number(yyyyStr || "1970");
  const hour = Math.max(0, Math.min(23, Math.floor((t || 0) / 3600)));
  const y = String(yyyy).padStart(4, "0");
  const m = String(mm).padStart(2, "0");
  const d = String(dd).padStart(2, "0");
  const h = String(hour).padStart(2, "0");
  return `${y}-${m}-${d}T${h}`;
}

type WeatherAwareMap = maplibregl.Map & { __tpHour?: string };

export function ensureSurfacePrecipHour(map: maplibregl.Map, isoHour: string) {
  if (!map || !map.isStyleLoaded()) return;

  const weatherMap = map as WeatherAwareMap;
  const prevHour: string | undefined = weatherMap.__tpHour;
  if (prevHour === isoHour && map.getLayer(SURFACE_PRECIP_LAYER_ID)) {
    try {
      map.setPaintProperty(SURFACE_PRECIP_LAYER_ID, "raster-opacity", 0.65);
    } catch {}
    return;
  }

  const cog = encodeURIComponent(`${COG_BASE}/era5_tp_${isoHour}.tif`);
  const tiles = [buildRasterTile(cog, { rescale: [0, 5], colormap_name: "viridis", resampling_method: "bilinear" })];

  if (map.getLayer(SURFACE_PRECIP_LAYER_ID)) {
    try { map.removeLayer(SURFACE_PRECIP_LAYER_ID); } catch {}
  }
  if (map.getSource(SURFACE_PRECIP_LAYER_ID)) {
    try { map.removeSource(SURFACE_PRECIP_LAYER_ID); } catch {}
  }

  const source: maplibregl.RasterSourceSpecification = {
    type: "raster",
    tiles,
    tileSize: 256,
    attribution: "ECMWF/Copernicus"
  };
  map.addSource(SURFACE_PRECIP_LAYER_ID, source);

  const beforeId = LAYER_ORDER_PREFERENCE.find((layerId) => map.getLayer(layerId));
  const layer: maplibregl.RasterLayerSpecification = {
    id: SURFACE_PRECIP_LAYER_ID,
    type: "raster",
    source: SURFACE_PRECIP_LAYER_ID,
    paint: { "raster-opacity": 0.65 }
  };
  map.addLayer(layer, beforeId);

  weatherMap.__tpHour = isoHour;
}

export function hideSurfacePrecipLayer(map: maplibregl.Map) {
  if (!map || !map.isStyleLoaded()) return;
  try {
    if (map.getLayer(SURFACE_PRECIP_LAYER_ID)) {
      map.setPaintProperty(SURFACE_PRECIP_LAYER_ID, "raster-opacity", 0);
    }
  } catch {}
}

function buildRasterTile(urlEncodedCog: string, params?: { rescale?: [number, number]; colormap_name?: string; resampling_method?: string; nodata?: number }): string {
  const qp: string[] = [`url=${urlEncodedCog}`];
  if (params?.rescale) qp.push(`rescale=${params.rescale[0]},${params.rescale[1]}`);
  if (params?.colormap_name) qp.push(`colormap_name=${params.colormap_name}`);
  if (params?.resampling_method) qp.push(`resampling_method=${params.resampling_method}`);
  if (params?.nodata !== undefined) qp.push(`nodata=${params.nodata}`);
  return `${TITILER_BASE}/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?${qp.join("&")}`;
}
