/**
 * Central configuration for data file paths
 * This module provides a single source of truth for all data file locations
 */

/**
 * Path to the main flight trajectories CSV file
 */
export const FLIGHTS_CSV_PATH = "/data/flights_20230717_0000-2359.csv";

/**
 * Primary path to the airspace GeoJSON file
 */
export const AIRSPACE_GEOJSON_PATH = "/data/wxm_sm_ih_maxpool_plus_nonas.geojson";

/**
 * Path to collapsed sectors artifact
 */
export const COLLAPSED_SECTORS_GEOJSON_PATH = "/data/collapsed_sectors.geojson";

// Backward-compatible alias while older call sites are migrated.
export const ELEMENTARY_SECTORS_GEOJSON_PATH = COLLAPSED_SECTORS_GEOJSON_PATH;

/**
 * Fallback path to the airspace JSON file (for backwards compatibility)
 */
export const AIRSPACE_JSON_PATH = "/data/airspace.json";

/**
 * Array of airspace file paths to try in order of preference
 */
export const AIRSPACE_PATH_CANDIDATES = [
  AIRSPACE_GEOJSON_PATH,
  AIRSPACE_JSON_PATH,
] as const;

/**
 * Path to traffic-volume capacity range mapping data
 */
export const TV_CAPACITY_RANGES_BY_ES_PATH = "/data/tv_capacity_ranges_by_es_test.json";
