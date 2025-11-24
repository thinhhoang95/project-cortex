import { loadSectors } from "./airspace";
import type { SectorFeatureProps } from "./models";
import { AIRSPACE_PATH_CANDIDATES } from "./dataPaths";

export type TrafficVolumeFeature = GeoJSON.Feature<GeoJSON.Geometry, SectorFeatureProps>;

const TRAFFIC_VOLUME_URL_CANDIDATES = AIRSPACE_PATH_CANDIDATES;

let trafficVolumeFeatureCollection: GeoJSON.FeatureCollection | null = null;
let trafficVolumeFeatureMap: Map<string, TrafficVolumeFeature> | null = null;
let trafficVolumeLoadPromise: Promise<Map<string, TrafficVolumeFeature>> | null = null;

function normalizeTrafficVolumeId(id: string | null | undefined): string {
  if (!id) return "";
  return String(id).trim();
}

function buildFeatureMap(collection: GeoJSON.FeatureCollection): Map<string, TrafficVolumeFeature> {
  const map = new Map<string, TrafficVolumeFeature>();
  if (!collection || !Array.isArray(collection.features)) return map;

  for (const feature of collection.features) {
    if (!feature || typeof feature !== "object") continue;
    const properties = (feature as TrafficVolumeFeature)?.properties;
    const rawId = normalizeTrafficVolumeId(properties?.traffic_volume_id as string | null | undefined);
    if (!rawId) continue;
    map.set(rawId, feature as TrafficVolumeFeature);
  }

  return map;
}

async function loadTrafficVolumeCollection(): Promise<GeoJSON.FeatureCollection> {
  let lastError: unknown = null;
  for (const url of TRAFFIC_VOLUME_URL_CANDIDATES) {
    try {
      const collection = await loadSectors(url);
      if (collection && collection.type === "FeatureCollection") {
        return collection as GeoJSON.FeatureCollection;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("Failed to load traffic volume definitions.");
}

async function ensureTrafficVolumeMap(): Promise<Map<string, TrafficVolumeFeature>> {
  if (trafficVolumeFeatureMap) {
    return trafficVolumeFeatureMap;
  }

  if (!trafficVolumeLoadPromise) {
    trafficVolumeLoadPromise = (async () => {
      const collection = await loadTrafficVolumeCollection();
      trafficVolumeFeatureCollection = collection;
      const map = buildFeatureMap(collection);
      trafficVolumeFeatureMap = map;
      return map;
    })().catch((err) => {
      trafficVolumeLoadPromise = null;
      trafficVolumeFeatureCollection = null;
      trafficVolumeFeatureMap = null;
      throw err;
    });
  }

  return trafficVolumeLoadPromise;
}

export async function preloadTrafficVolumes(): Promise<void> {
  await ensureTrafficVolumeMap();
}

export async function fetchTrafficVolumeFeature(id: string): Promise<TrafficVolumeFeature | null> {
  const normalized = normalizeTrafficVolumeId(id);
  if (!normalized) return null;
  const map = await ensureTrafficVolumeMap();
  return map.get(normalized) ?? null;
}

export function getCachedTrafficVolumeFeature(id: string): TrafficVolumeFeature | null {
  const normalized = normalizeTrafficVolumeId(id);
  if (!normalized || !trafficVolumeFeatureMap) return null;
  return trafficVolumeFeatureMap.get(normalized) ?? null;
}

export async function fetchTrafficVolumeProperties(id: string): Promise<SectorFeatureProps | null> {
  const feature = await fetchTrafficVolumeFeature(id);
  return feature?.properties ?? null;
}

export function getCachedTrafficVolumeProperties(id: string): SectorFeatureProps | null {
  return getCachedTrafficVolumeFeature(id)?.properties ?? null;
}

export function listTrafficVolumeIdsSync(): string[] | null {
  if (!trafficVolumeFeatureMap) return null;
  return Array.from(trafficVolumeFeatureMap.keys());
}

export function getTrafficVolumeFeatureCollectionSync(): GeoJSON.FeatureCollection | null {
  return trafficVolumeFeatureCollection;
}
