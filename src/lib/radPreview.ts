"use client";

import { authFetch } from "@/lib/auth";
import { buildFlightIdIndex } from "@/lib/flightIdentity";
import type { Trajectory } from "@/lib/models";

export type RadLegitimacyFlag = "L" | "I";
export type RadSupportStatus = "supported" | "unsupported" | "partial" | string;
export type RadPreviewSortMode = "default" | "L" | "I";
export const RAD_PREVIEW_SEARCH_FIELDS = [
  "Airway",
  "From",
  "To",
  "Utilization",
  "Point/Airspace",
] as const;
export type RadPreviewSearchField = (typeof RAD_PREVIEW_SEARCH_FIELDS)[number];
export type RadPreviewSearchResponseField =
  | "airway"
  | "from"
  | "to"
  | "utilization"
  | "point_or_airspace";

export interface RadPreviewSourcePaths {
  flight_rad_hits_path?: string;
  rad_rule_metadata_path?: string;
  rules_csv_path?: string;
  traffic_volumes_path?: string;
}

export interface RadPreviewSourceCsvFields {
  change_indicator?: string;
  categorisation?: string;
  operational_goal?: string;
  remarks?: string;
  atc_unit?: string;
  nas_fab?: string;
  release_date?: string;
  special_event_and_crisis?: string;
}

export interface RadPreviewInstance {
  rule_instance_id: number;
  csv_row_number: number | null;
  bundle_index?: number | null;
  rad_id: string;
  effect?: string | null;
  supported?: boolean | null;
  valid_from?: string | null;
  valid_until?: string | null;
  airway?: string | null;
  from?: string | null;
  to?: string | null;
  point_or_airspace?: string | null;
  time_applicability?: string | null;
  utilization?: string | null;
  primary_tokens?: string[] | null;
  selector_candidates?: string[] | null;
  diagnostics?: string[] | null;
  source_csv?: RadPreviewSourceCsvFields | null;
}

export interface RadPreviewRelevance {
  match_types?: string[] | null;
  matching_rule_instance_ids?: number[] | null;
  matching_rule_instance_ids_by_type?: Record<string, number[]> | null;
}

export interface RadPreviewRow {
  rad_id: string;
  first_rule_instance_id: number | null;
  first_csv_row_number: number | null;
  total_instances: number;
  supported_instance_count: number;
  unsupported_instance_count: number;
  support_status: RadSupportStatus;
  rule_instance_ids: number[];
  matching_rule_instance_ids_by_flag: Record<RadLegitimacyFlag, number[]>;
  flight_counts: Record<RadLegitimacyFlag, number>;
  instances: RadPreviewInstance[];
  relevance?: RadPreviewRelevance | null;
}

export interface PreviewRadsResponse {
  items: RadPreviewRow[];
  count: number;
  total_available: number;
  limit: number;
  truncated: boolean;
  search?: string;
  fields?: RadPreviewSearchResponseField[];
  exact_match?: boolean;
  resource_date?: string | null;
  case_dir?: string | null;
  source_paths?: RadPreviewSourcePaths | null;
}

export interface PreviewRadsForTrafficVolumeResponse extends PreviewRadsResponse {
  traffic_volume_id: string;
  traffic_volume_kind?: string | null;
}

export interface PreviewRadFlightListResponse {
  rad_id: string;
  legitimacy_flag: RadLegitimacyFlag;
  flight_ids: string[];
  count: number;
  rule_instance_ids: number[];
  matching_rule_instance_ids: number[];
  resource_date?: string | null;
  case_dir?: string | null;
  source_paths?: RadPreviewSourcePaths | null;
}

export interface RadFlightRow {
  flightId: string;
  callSign: string;
  origin: string;
  destination: string;
  takeoffTime: string;
  flight: Trajectory | null;
  unresolved: boolean;
}

export interface FetchPreviewRadsSearchOptions {
  search: string;
  fields: RadPreviewSearchField[];
  exactMatch?: boolean;
  limit?: number;
}

export interface FetchPreviewRadsForTrafficVolumeOptions {
  trafficVolumeId: string;
  limit?: number;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = payload as Record<string, unknown>;
    const message =
      record?.detail ||
      record?.error ||
      record?.message ||
      `Request failed (${response.status})`;
    throw new Error(String(message));
  }
  return payload as T;
}

const RAD_PREVIEW_SEARCH_FIELD_SET = new Set<string>(RAD_PREVIEW_SEARCH_FIELDS);

function sanitizePreviewRadsLimit(limit?: number): number | null {
  if (!Number.isFinite(limit)) return null;
  return Math.max(1, Math.min(250, Math.floor(Number(limit))));
}

function normalizePreviewRadsSearchFields(fields: RadPreviewSearchField[]): RadPreviewSearchField[] {
  const seen = new Set<string>();
  const normalized: RadPreviewSearchField[] = [];

  for (const field of fields) {
    if (!RAD_PREVIEW_SEARCH_FIELD_SET.has(field) || seen.has(field)) continue;
    seen.add(field);
    normalized.push(field);
  }

  return normalized;
}

export function buildPreviewRadsPath(limit?: number): string {
  const params = new URLSearchParams();
  const safeLimit = sanitizePreviewRadsLimit(limit);
  if (safeLimit !== null) {
    params.set("limit", String(safeLimit));
  }
  return `/api/preview_rads${params.size > 0 ? `?${params.toString()}` : ""}`;
}

export function buildPreviewRadsForTrafficVolumePath({
  trafficVolumeId,
  limit,
}: FetchPreviewRadsForTrafficVolumeOptions): string {
  const normalizedTrafficVolumeId = String(trafficVolumeId ?? "").trim();
  if (!normalizedTrafficVolumeId) {
    throw new Error("trafficVolumeId parameter is required");
  }

  const params = new URLSearchParams({ traffic_volume_id: normalizedTrafficVolumeId });
  const safeLimit = sanitizePreviewRadsLimit(limit);
  if (safeLimit !== null) {
    params.set("limit", String(safeLimit));
  }

  return `/api/preview_rads_for_traffic_volume?${params.toString()}`;
}

export function buildPreviewRadsSearchPath({
  search,
  fields,
  exactMatch = false,
  limit,
}: FetchPreviewRadsSearchOptions): string {
  const normalizedSearch = String(search ?? "").trim();
  if (!normalizedSearch) {
    throw new Error("search parameter is required");
  }

  const normalizedFields = normalizePreviewRadsSearchFields(fields);
  if (!normalizedFields.length) {
    throw new Error("at least one search field is required");
  }

  const params = new URLSearchParams({ search: normalizedSearch });
  for (const field of normalizedFields) {
    params.append("fields", field);
  }

  if (exactMatch) {
    params.set("exact_match", "true");
  }

  const safeLimit = sanitizePreviewRadsLimit(limit);
  if (safeLimit !== null) {
    params.set("limit", String(safeLimit));
  }

  return `/api/preview_rads_search?${params.toString()}`;
}

export async function fetchPreviewRads(limit?: number): Promise<PreviewRadsResponse> {
  const response = await authFetch(buildPreviewRadsPath(limit));
  return parseJsonResponse<PreviewRadsResponse>(response);
}

export async function fetchPreviewRadsForTrafficVolume(
  options: FetchPreviewRadsForTrafficVolumeOptions,
): Promise<PreviewRadsForTrafficVolumeResponse> {
  const response = await authFetch(buildPreviewRadsForTrafficVolumePath(options));
  return parseJsonResponse<PreviewRadsForTrafficVolumeResponse>(response);
}

export async function fetchPreviewRadsSearch(
  options: FetchPreviewRadsSearchOptions,
): Promise<PreviewRadsResponse> {
  const response = await authFetch(buildPreviewRadsSearchPath(options));
  return parseJsonResponse<PreviewRadsResponse>(response);
}

export async function fetchPreviewRadFlightList(
  radId: string,
  legitimacyFlag: RadLegitimacyFlag,
): Promise<PreviewRadFlightListResponse> {
  const normalizedRadId = String(radId ?? "").trim();
  const normalizedFlag = legitimacyFlag === "I" ? "I" : "L";
  const params = new URLSearchParams({
    rad_id: normalizedRadId,
    legitimacy_flag: normalizedFlag,
  });
  const response = await authFetch(`/api/preview_rad_flight_list?${params.toString()}`);
  return parseJsonResponse<PreviewRadFlightListResponse>(response);
}

export function buildRadFlightCacheKey(
  resourceStateEpoch: number,
  radId: string,
  legitimacyFlag: RadLegitimacyFlag,
): string {
  return `${Math.max(0, Math.floor(resourceStateEpoch || 0))}|${normalizeRadId(radId)}|${legitimacyFlag}`;
}

export function normalizeRadId(radId: string | null | undefined): string {
  return String(radId ?? "").trim().toUpperCase();
}

const SEARCH_VALUE_ACCESSORS: Record<
  RadPreviewSearchField,
  (instance: RadPreviewInstance) => string | null | undefined
> = {
  Airway: (instance) => instance.airway,
  From: (instance) => instance.from,
  To: (instance) => instance.to,
  Utilization: (instance) => instance.utilization,
  "Point/Airspace": (instance) => instance.point_or_airspace,
};

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function collectRowSearchValues(row: RadPreviewRow, field: RadPreviewSearchField): string[] {
  const accessor = SEARCH_VALUE_ACCESSORS[field];
  const seen = new Set<string>();
  const values: string[] = [];

  for (const instance of row.instances ?? []) {
    const normalized = String(accessor(instance) ?? "").trim();
    if (!normalized) continue;
    const dedupeKey = normalizeSearchValue(normalized);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    values.push(normalized);
  }

  return values;
}

export function rowMatchesRadPreviewSearch(
  row: RadPreviewRow,
  options: Pick<FetchPreviewRadsSearchOptions, "search" | "fields" | "exactMatch">,
): boolean {
  const normalizedSearch = normalizeSearchValue(String(options.search ?? ""));
  if (!normalizedSearch) return true;

  const normalizedFields = normalizePreviewRadsSearchFields(options.fields);
  if (!normalizedFields.length) return false;

  return normalizedFields.some((field) =>
    collectRowSearchValues(row, field).some((value) => {
      const normalizedValue = normalizeSearchValue(value);
      return options.exactMatch ? normalizedValue === normalizedSearch : normalizedValue.includes(normalizedSearch);
    }),
  );
}

export function filterRadPreviewRowsLocally(
  rows: RadPreviewRow[],
  options: Pick<FetchPreviewRadsSearchOptions, "search" | "fields" | "exactMatch">,
): RadPreviewRow[] {
  return rows.filter((row) => rowMatchesRadPreviewSearch(row, options));
}

export function formatTimeOfDay(seconds: number | null | undefined): string {
  if (!Number.isFinite(seconds)) return "—";
  const safe = Math.max(0, Math.min(24 * 3600 - 1, Math.floor(Number(seconds))));
  const hh = Math.floor(safe / 3600);
  const mm = Math.floor((safe % 3600) / 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function mapRadFlightRows(
  flightIds: Iterable<string | null | undefined>,
  flights: Trajectory[],
): RadFlightRow[] {
  const flightsById = buildFlightIdIndex(flights);
  const rows: RadFlightRow[] = [];

  for (const rawId of flightIds) {
    const flightId = String(rawId ?? "").trim();
    if (!flightId) continue;

    const flight = flightsById.get(flightId) ?? null;
    rows.push({
      flightId,
      callSign: flight?.callSign ? String(flight.callSign) : flightId,
      origin: flight?.origin ? String(flight.origin) : "—",
      destination: flight?.destination ? String(flight.destination) : "—",
      takeoffTime: formatTimeOfDay(flight?.t0),
      flight,
      unresolved: !flight,
    });
  }

  return rows;
}
