import resourceManifestJson from "../../public/data/resource_manifest.json";

export type ResourceManifestResourceKey =
  | "flightsCsv"
  | "airspaceGeojson"
  | "collapsedSectorsGeojson"
  | "airspaceJson"
  | "tvCapacityRanges";

export type ResourceManifestEntry = {
  resources: Record<ResourceManifestResourceKey, string>;
};

export type ResourceManifest = {
  version: number;
  dates: Record<string, Partial<ResourceManifestEntry>>;
};

export type ResolvedResourcePaths = {
  flightsCsv: string;
  airspaceGeojson: string;
  collapsedSectorsGeojson: string;
  airspaceJson: string;
  tvCapacityRanges: string;
  airspaceCandidates: readonly [string, string];
};

const REQUIRED_RESOURCE_KEYS: readonly ResourceManifestResourceKey[] = [
  "flightsCsv",
  "airspaceGeojson",
  "collapsedSectorsGeojson",
  "airspaceJson",
  "tvCapacityRanges",
] as const;

const bundledManifest = resourceManifestJson as ResourceManifest;
let runtimeManifestOverride: ResourceManifest | null = null;

function isNonEmptyPath(value: unknown): value is string {
  return typeof value === "string" && value.trim().startsWith("/");
}

function withDateCacheKey(path: string, date: string): string {
  const normalizedPath = String(path ?? "").trim();
  if (!normalizedPath) return normalizedPath;
  const joiner = normalizedPath.includes("?") ? "&" : "?";
  return `${normalizedPath}${joiner}resourceDate=${encodeURIComponent(date)}`;
}

function getManifestEntry(date: string): Partial<ResourceManifestEntry> | null {
  const normalizedDate = String(date ?? "").trim();
  if (!normalizedDate) return null;
  return getResourceManifest().dates?.[normalizedDate] ?? null;
}

export function getResourceManifest(): ResourceManifest {
  return runtimeManifestOverride ?? bundledManifest;
}

function isValidResourceManifest(input: unknown): input is ResourceManifest {
  if (!input || typeof input !== "object") return false;
  const version = (input as ResourceManifest).version;
  const dates = (input as ResourceManifest).dates;
  return typeof version === "number" && !!dates && typeof dates === "object";
}

export async function refreshRuntimeResourceManifest(): Promise<ResourceManifest> {
  if (typeof window === "undefined") {
    return getResourceManifest();
  }

  const response = await fetch("/data/resource_manifest.json", { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to refresh resource manifest: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (!isValidResourceManifest(payload)) {
    throw new Error("Failed to refresh resource manifest: invalid payload");
  }

  runtimeManifestOverride = payload;
  return runtimeManifestOverride;
}

export function listLocalResourceDates(): string[] {
  return Object.keys(getResourceManifest().dates ?? {}).sort();
}

export function getManifestMissingKeys(date: string): ResourceManifestResourceKey[] {
  const entry = getManifestEntry(date);
  if (!entry?.resources || typeof entry.resources !== "object") {
    return REQUIRED_RESOURCE_KEYS.slice();
  }

  return REQUIRED_RESOURCE_KEYS.filter((key) => !isNonEmptyPath(entry.resources?.[key]));
}

export function hasLocalResourceSupport(date: string): boolean {
  return getManifestMissingKeys(date).length === 0;
}

export function getResourcePathsForDate(date: string): ResolvedResourcePaths {
  const normalizedDate = String(date ?? "").trim();
  const entry = getManifestEntry(normalizedDate);
  const missingKeys = getManifestMissingKeys(normalizedDate);

  if (!entry?.resources || missingKeys.length > 0) {
    throw new Error(
      `Local resource manifest is incomplete for ${normalizedDate || "unknown date"}: ${missingKeys.join(", ")}`
    );
  }

  const flightsCsv = withDateCacheKey(entry.resources.flightsCsv, normalizedDate);
  const airspaceGeojson = withDateCacheKey(entry.resources.airspaceGeojson, normalizedDate);
  const collapsedSectorsGeojson = withDateCacheKey(entry.resources.collapsedSectorsGeojson, normalizedDate);
  const airspaceJson = withDateCacheKey(entry.resources.airspaceJson, normalizedDate);
  const tvCapacityRanges = withDateCacheKey(entry.resources.tvCapacityRanges, normalizedDate);

  return {
    flightsCsv,
    airspaceGeojson,
    collapsedSectorsGeojson,
    airspaceJson,
    tvCapacityRanges,
    airspaceCandidates: [airspaceGeojson, airspaceJson],
  };
}

export function getFlightsCsvPath(date: string): string {
  return getResourcePathsForDate(date).flightsCsv;
}

export function getAirspaceGeojsonPath(date: string): string {
  return getResourcePathsForDate(date).airspaceGeojson;
}

export function getCollapsedSectorsGeojsonPath(date: string): string {
  return getResourcePathsForDate(date).collapsedSectorsGeojson;
}

export function getAirspaceJsonPath(date: string): string {
  return getResourcePathsForDate(date).airspaceJson;
}

export function getAirspacePathCandidates(date: string): readonly [string, string] {
  return getResourcePathsForDate(date).airspaceCandidates;
}

export function getTvCapacityRangesPath(date: string): string {
  return getResourcePathsForDate(date).tvCapacityRanges;
}
