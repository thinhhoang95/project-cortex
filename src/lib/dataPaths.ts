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
