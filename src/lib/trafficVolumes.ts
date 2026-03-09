import { loadSectors } from "./airspace";
import type { SectorFeatureProps } from "./models";
import { getAirspacePathCandidates, listLocalResourceDates } from "./dataPaths";
import { useSimStore } from "@/components/useSimStore";

export type TrafficVolumeFeature = GeoJSON.Feature<GeoJSON.Geometry, SectorFeatureProps>;

const trafficVolumeFeatureCollectionByDate = new Map<string, GeoJSON.FeatureCollection>();
const trafficVolumeFeatureMapByDate = new Map<string, Map<string, TrafficVolumeFeature>>();
const trafficVolumeLoadPromiseByDate = new Map<string, Promise<Map<string, TrafficVolumeFeature>>>();

export function clearTrafficVolumeCache(): void {
  trafficVolumeFeatureCollectionByDate.clear();
  trafficVolumeFeatureMapByDate.clear();
  trafficVolumeLoadPromiseByDate.clear();
}

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

function getCurrentResourceDate(): string {
  return useSimStore.getState().resourceDate ?? listLocalResourceDates()[0] ?? "";
}

async function loadTrafficVolumeCollection(resourceDate: string): Promise<GeoJSON.FeatureCollection> {
  let lastError: unknown = null;
  for (const url of getAirspacePathCandidates(resourceDate)) {
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

async function ensureTrafficVolumeMap(resourceDate = getCurrentResourceDate()): Promise<Map<string, TrafficVolumeFeature>> {
  const cachedMap = trafficVolumeFeatureMapByDate.get(resourceDate);
  if (cachedMap) {
    return cachedMap;
  }

  if (!trafficVolumeLoadPromiseByDate.has(resourceDate)) {
    trafficVolumeLoadPromiseByDate.set(resourceDate, (async () => {
      const collection = await loadTrafficVolumeCollection(resourceDate);
      trafficVolumeFeatureCollectionByDate.set(resourceDate, collection);
      const map = buildFeatureMap(collection);
      trafficVolumeFeatureMapByDate.set(resourceDate, map);
      return map;
    })().catch((err) => {
      trafficVolumeLoadPromiseByDate.delete(resourceDate);
      trafficVolumeFeatureCollectionByDate.delete(resourceDate);
      trafficVolumeFeatureMapByDate.delete(resourceDate);
      throw err;
    }));
  }

  return trafficVolumeLoadPromiseByDate.get(resourceDate)!;
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
  const resourceDate = getCurrentResourceDate();
  if (!normalized || !resourceDate) return null;
  return trafficVolumeFeatureMapByDate.get(resourceDate)?.get(normalized) ?? null;
}

export async function fetchTrafficVolumeProperties(id: string): Promise<SectorFeatureProps | null> {
  const feature = await fetchTrafficVolumeFeature(id);
  return feature?.properties ?? null;
}

export function getCachedTrafficVolumeProperties(id: string): SectorFeatureProps | null {
  return getCachedTrafficVolumeFeature(id)?.properties ?? null;
}

export function listTrafficVolumeIdsSync(): string[] | null {
  const resourceDate = getCurrentResourceDate();
  if (!resourceDate) return null;
  const map = trafficVolumeFeatureMapByDate.get(resourceDate);
  if (!map) return null;
  return Array.from(map.keys());
}

export function getTrafficVolumeFeatureCollectionSync(): GeoJSON.FeatureCollection | null {
  const resourceDate = getCurrentResourceDate();
  if (!resourceDate) return null;
  return trafficVolumeFeatureCollectionByDate.get(resourceDate) ?? null;
}
