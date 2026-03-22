import type { ResolvedResourcePaths } from "@/lib/dataPaths";
import type { ResourceStateSummary } from "@/lib/resourceStates";
import {
  getManifestMissingKeys,
  getResourceManifest,
  getResourcePathsForDate,
  hasLocalResourceSupport,
  listLocalResourceDates,
} from "@/lib/dataPaths";

export type ResourceContextResponse = {
  selected_date: string | null;
  available_dates: string[];
  manifest_path: string | null;
  generation: number;
  resolved_paths: Record<string, string> | null;
  selected_state_id?: string | null;
  head_state_id?: string | null;
  state_zero_id?: string | null;
  num_states?: number;
  state_history_generation?: number;
  states?: ResourceStateSummary[];
  status?: string;
};

export type ResourceDateStatus = "ready" | "missing_local" | "missing_api" | "missing_both";

export type ResourceDateAvailability = {
  date: string;
  status: ResourceDateStatus;
  localSupported: boolean;
  apiSupported: boolean;
  missingLocalKeys: string[];
  isActive: boolean;
};

export function isIsoDateString(value: string | null | undefined): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "").trim());
}

export function formatResourceDateForDisplay(date: string | null | undefined): string {
  if (!isIsoDateString(date)) return "Select Date";
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "long",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export function getDateDisplayParts(date: string | null | undefined): {
  dow: string;
  month: string;
  day: string;
  year: string;
} {
  if (!isIsoDateString(date)) {
    return { dow: "N/A", month: "SELECT", day: "--", year: "----" };
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "long",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
  const parts = formatter.formatToParts(parsed);
  const lookup = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    dow: lookup("weekday").toUpperCase(),
    month: lookup("month").toUpperCase(),
    day: lookup("day").padStart(2, "0"),
    year: lookup("year"),
  };
}

export function getCurrentLocalManifestDates(): string[] {
  return listLocalResourceDates();
}

export function resolveLocalResourcePaths(date: string): ResolvedResourcePaths | null {
  if (!hasLocalResourceSupport(date)) return null;
  return getResourcePathsForDate(date);
}

export function getLocalManifestDebugInfo(date: string) {
  return {
    version: getResourceManifest().version,
    missingKeys: getManifestMissingKeys(date),
  };
}

export function mergeResourceAvailability(
  context: ResourceContextResponse | null,
  selectedDate: string | null | undefined,
): ResourceDateAvailability[] {
  const localDates = new Set(listLocalResourceDates());
  const apiDates = new Set((context?.available_dates ?? []).filter(isIsoDateString));
  const allDates = Array.from(new Set([...localDates, ...apiDates])).sort();
  const activeDate = selectedDate ?? context?.selected_date ?? null;

  return allDates.map((date) => {
    const localSupported = hasLocalResourceSupport(date);
    const apiSupported = apiDates.has(date);
    let status: ResourceDateStatus = "ready";

    if (!localSupported && !apiSupported) {
      status = "missing_both";
    } else if (!localSupported) {
      status = "missing_local";
    } else if (!apiSupported) {
      status = "missing_api";
    }

    return {
      date,
      status,
      localSupported,
      apiSupported,
      missingLocalKeys: getManifestMissingKeys(date),
      isActive: activeDate === date,
    };
  });
}

export function isResourceDateReady(
  date: string | null | undefined,
  context: ResourceContextResponse | null,
): boolean {
  if (!isIsoDateString(date)) return false;
  return mergeResourceAvailability(context, date).some((entry) => entry.date === date && entry.status === "ready");
}

export function getResourceStatusLabel(status: ResourceDateStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "missing_local":
      return "Missing local data";
    case "missing_api":
      return "Missing API support";
    default:
      return "Unavailable";
  }
}
