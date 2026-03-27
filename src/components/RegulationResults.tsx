"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
// charts are handled by OccupancyPrePostPanel
import {
  RegulationPlanPerAccAttribMode,
  RegulationPlanSimulationResponse,
  Trajectory,
} from "@/lib/models";
import { useSimStore } from "@/components/useSimStore";
import ModalDialog from "./ModalDialog";
import OccupancyPrePostPanel, {
  type OccupancyPrePostSortMode,
} from "@/components/OccupancyPrePostPanel";
import TimeScaleControl from "@/components/TimeScaleControl";
import FlightStatisticsButton from "@/components/FlightStatisticsButton";
import { minutesToHHMM } from "@/lib/time";
import ShimmeringText from "./ShimmeringText";
import { simulateRegulationPlan } from "@/lib/regulationPlanSimulation";
import { buildFlightIdIndex, buildUniqueCallsignIndex } from "@/lib/flightIdentity";
import { normalizeRegulationContext } from "@/lib/regulationTargets";
import PerAccDelayAttributionPanel from "@/components/PerAccDelayAttributionPanel";
import { normalizePerAccAttribMode } from "@/lib/perAccAttribution";
import {
  ResponsiveContainer,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Bar,
} from "recharts";
import {
  RegulationSnapshot,
  loadRegSnapshots,
  createRegulationSnapshot,
  addRegSnapshot,
  MAX_REG_SNAPSHOTS,
  estimateRegSnapshotsSize,
  REG_SNAPSHOT_SIZE_WARN_THRESHOLD,
  RegSnapshotLimitError,
  REG_SNAPSHOT_STORAGE_KEY,
} from "@/lib/reg-comparison";
import { commitResourceStateHistory } from "@/lib/resourceContextClient";
import {
  PER_ACC_COMPARISON_MODES,
  clonePerAccAttrib,
  type StoredPerAccAttribByMode,
} from "@/lib/perAccComparison";
import {
  refreshResourceStateFromServer,
  ResourceDateOutOfSyncError,
} from "@/lib/resourceStateSync";
import { buildResourceStateHistoryCommitFromSimulation } from "@/lib/regulationStateCommit";

interface RegulationResultsProps {
  open: boolean;
  result: RegulationPlanSimulationResponse | null;
  onClose: () => void;
}

function formatSecondsToHMM(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return "-";
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// removed bin-to-label util (handled in component)

function parseTimeToSeconds(t: string | null | undefined): number {
  if (!t) return Number.POSITIVE_INFINITY;
  const s = String(t).trim();
  if (!s) return Number.POSITIVE_INFINITY;
  // If formatted with colons: HH:MM or HH:MM:SS
  if (s.includes(":")) {
    const parts = s.split(":").map(p => Number(p));
    if (parts.some(p => !Number.isFinite(p) || p < 0)) return Number.POSITIVE_INFINITY;
    const [hh, mm = 0, ss = 0] = parts;
    return (hh * 3600) + (mm * 60) + ss;
  }
  // Compact HMS format (e.g., "754" => 00:07:54, "50007" => 05:00:07)
  if (!/^\d+$/.test(s)) return Number.POSITIVE_INFINITY;
  const len = s.length;
  if (len < 1) return Number.POSITIVE_INFINITY;
  const ss = Number(s.slice(-2));
  const mm = len > 2 ? Number(s.slice(-4, -2) || 0) : 0;
  const hh = len > 4 ? Number(s.slice(0, -4) || 0) : (len === 3 ? 0 : 0);
  if (![hh, mm, ss].every(v => Number.isFinite(v) && v >= 0)) return Number.POSITIVE_INFINITY;
  return (hh * 3600) + (mm * 60) + ss;
}

type AirportDelayRow = {
  airport: string;
  flightCount: number;
  totalDelay: number;
  averageDelay: number;
  maxDelay: number;
  minDelay: number;
};

type HeaviestDelayInfo = {
  flightId: string;
  callSign: string;
  origin: string;
  destination: string;
  delay: number;
};

type AirportDelayChartRow = {
  airport: string;
  departureDelay: number;
  arrivalDelay: number;
  departureFlights: number;
  arrivalFlights: number;
  total: number;
  totalFlights: number;
};

type ObjectiveComponentEntry = {
  key: string;
  normalizedKey: string;
  value: number;
};

type WeightEntry = {
  key: string;
  value: number;
};

type DelayMetric = {
  minutes: number | null;
  seconds: number | null;
};

const toTrimmedString = (value: unknown): string => {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value == null) {
    return "";
  }
  try {
    return String(value).trim();
  } catch {
    return "";
  }
};

const stringWithFallback = (value: unknown, fallback: string): string => {
  const trimmed = toTrimmedString(value);
  return trimmed.length > 0 ? trimmed : fallback;
};

const normalizeAirportLabel = (value: unknown): string => stringWithFallback(value, "Unknown");

const AIRPORT_TABLE_LIMIT = 15;

const OBJECTIVE_COMPONENT_ORDER = ["J_CAP", "J_DELAY", "J_REG", "J_TV", "J_SHARE", "J_SPILL"] as const;
const readFiniteNumber = (value: unknown): number | null => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const normalizeObjectiveKey = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  return raw
    .toString()
    .trim()
    .replace(/[^0-9a-zA-Z]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_")
    .toUpperCase();
};

const extractDelayMetric = (
  stats: RegulationPlanSimulationResponse["delay_stats"] | undefined,
  prefix: "total" | "mean" | "max" | "min",
): DelayMetric => {
  if (!stats) return { minutes: null, seconds: null };
  const secondsKey = `${prefix}_delay_seconds`;
  const minutesKey = `${prefix}_delay_minutes`;
  const seconds = readFiniteNumber((stats as any)?.[secondsKey]);
  const minutes = readFiniteNumber((stats as any)?.[minutesKey]);

  if (seconds === null && minutes === null) {
    return { minutes: null, seconds: null };
  }

  if (seconds === null && minutes !== null) {
    return { minutes, seconds: minutes * 60 };
  }

  if (minutes === null && seconds !== null) {
    return { minutes: seconds / 60, seconds };
  }

  return { minutes, seconds };
};

const delayMetricHasValue = (metric: DelayMetric): boolean => {
  if (!metric) return false;
  return metric.minutes !== null || metric.seconds !== null;
};

const formatDelayMetricValue = (metric: DelayMetric, formatNumber: (value: number | null | undefined, digits?: number) => string): string => {
  if (!metric) return "—";
  if (metric.minutes !== null) {
    const digits = metric.minutes >= 100 ? 1 : 2;
    return `${formatNumber(metric.minutes, digits)} min`;
  }
  if (metric.seconds !== null) {
    return `${Math.round(metric.seconds).toLocaleString()} s`;
  }
  return "—";
};

const formatDelayMetricSub = (metric: DelayMetric): string | undefined => {
  if (!metric) return undefined;
  if (metric.seconds !== null) {
    return formatSecondsToHMM(metric.seconds);
  }
  if (metric.minutes !== null) {
    return formatSecondsToHMM(metric.minutes * 60);
  }
  return undefined;
};

export default function RegulationResults({ open, result, onClose }: RegulationResultsProps) {
  const router = useRouter();
  const flights = useSimStore(s => s.flights);
  const regulations = useSimStore(s => s.regulations);
  const resourceDate = useSimStore(s => s.resourceDate);
  const resourceStateSelectedId = useSimStore(s => s.resourceStateSelectedId);
  const resourceStateHeadId = useSimStore(s => s.resourceStateHeadId);
  const resourceStateLoading = useSimStore(s => s.resourceStateLoading);
  const syncResourceState = useSimStore(s => s.syncResourceState);
  const clearResourceDate = useSimStore(s => s.clearResourceDate);
  const clearResourceState = useSimStore(s => s.clearResourceState);
  const setResourceStateLoading = useSimStore(s => s.setResourceStateLoading);
  const setResourceStatePendingId = useSimStore(s => s.setResourceStatePendingId);
  const setResourceStateError = useSimStore(s => s.setResourceStateError);
  const setRegulationSimulationResult = useSimStore(s => s.setRegulationSimulationResult);
  const setIsRegulationPanelOpen = useSimStore(s => s.setIsRegulationPanelOpen);
  const clearRegulationTargetFlights = useSimStore(s => s.clearRegulationTargetFlights);
  const setRegulationEditPayload = useSimStore(s => s.setRegulationEditPayload);
  const currentRegulationContext = useMemo(
    () => normalizeRegulationContext({ resourceDate, resourceStateId: resourceStateSelectedId }),
    [resourceDate, resourceStateSelectedId],
  );
  const [viewFrom, setViewFrom] = useState<string>("00:00");
  const [viewTo, setViewTo] = useState<string>("23:59");
  const [sortMode, setSortMode] = useState<OccupancyPrePostSortMode>("abs_change");
  const [perAccAttribMode, setPerAccAttribMode] = useState<RegulationPlanPerAccAttribMode>("dwelling_spread");
  const [perAccAttribLoading, setPerAccAttribLoading] = useState(false);
  const [perAccAttribError, setPerAccAttribError] = useState<string | null>(null);
  const [regSnapshotPromptOpen, setRegSnapshotPromptOpen] = useState(false);
  const [regSnapshotDescription, setRegSnapshotDescription] = useState("");
  const [regSnapshotSaving, setRegSnapshotSaving] = useState(false);
  const [regSnapshotSaveError, setRegSnapshotSaveError] = useState<string | null>(null);
  const [regSnapshotReplaceId, setRegSnapshotReplaceId] = useState<string | null>(null);
  const [regSnapshotList, setRegSnapshotList] = useState<RegulationSnapshot[]>([]);
  const [regSnapshotToast, setRegSnapshotToast] = useState<{
    kind: "success" | "warning";
    message: string;
    action?: { label: string; href: string };
  } | null>(null);
  const [commitRegulationPending, setCommitRegulationPending] = useState(false);
  const [commitRegulationError, setCommitRegulationError] = useState<string | null>(null);
  const [showLegacyComponents, setShowLegacyComponents] = useState(false);
  const [showObjectiveWeights, setShowObjectiveWeights] = useState(false);

  const regSnapshotSizeBytes = useMemo(() => estimateRegSnapshotsSize(regSnapshotList), [regSnapshotList]);
  const regSnapshotSizeWarn = regSnapshotSizeBytes > REG_SNAPSHOT_SIZE_WARN_THRESHOLD;
  const regSnapshotSizeDisplayKb = Math.max(0, Math.round(regSnapshotSizeBytes / 1024));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const current = loadRegSnapshots();
    setRegSnapshotList(current);
    const onStorage = (ev: StorageEvent) => {
      if (ev.key && ev.key !== REG_SNAPSHOT_STORAGE_KEY) return;
      setRegSnapshotList(loadRegSnapshots());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!open) return;
    setRegSnapshotList(loadRegSnapshots());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setShowLegacyComponents(false);
    setShowObjectiveWeights(false);
  }, [open, result]);

  useEffect(() => {
    if (!open) return;
    setPerAccAttribMode(normalizePerAccAttribMode(result?.per_acc_attrib?.mode));
    setPerAccAttribLoading(false);
    setPerAccAttribError(null);
    setCommitRegulationPending(false);
    setCommitRegulationError(null);
  }, [open, result]);

  const handleResourceDateOutOfSync = useCallback(() => {
    clearResourceState();
    clearResourceDate();
    router.replace("/select-date?reason=out_of_sync");
  }, [clearResourceDate, clearResourceState, router]);

  const refreshFromServer = useCallback(async () => {
    await refreshResourceStateFromServer({
      expectedResourceDate: resourceDate,
      onOutOfSync: () => handleResourceDateOutOfSync(),
      syncResourceState,
    });
  }, [handleResourceDateOutOfSync, resourceDate, syncResourceState]);

  // Initialize default view window when modal opens based on plan regulations
  useEffect(() => {
    if (!open) return;
    const fromVals = regulations.map(r => Number(r.activeTimeWindowFrom)).filter(v => Number.isFinite(v) && v >= 0) as number[];
    const toVals = regulations.map(r => Number(r.activeTimeWindowTo)).filter(v => Number.isFinite(v) && v >= 0) as number[];
    if (fromVals.length > 0 && toVals.length > 0) {
      const minFrom = Math.min(...fromVals);
      const maxTo = Math.max(...toVals);
      setViewFrom(minutesToHHMM(Math.floor(minFrom / 60)));
      setViewTo(minutesToHHMM(Math.min(1439, Math.floor(maxTo / 60))));
    } else {
      setViewFrom("00:00");
      setViewTo("23:59");
    }
  }, [open, regulations]);

  const delayRows = useMemo(() => {
    const byFlight = result?.delays_by_flight || {};
    const rows = Object.entries(byFlight).map(([flightId, delayMinutesRaw]) => {
      const delayMinutes = Number(delayMinutesRaw) || 0;
      const f = flights.find(ff => String(ff.flightId) === String(flightId));
      const callsign = f?.callSign ? String(f?.callSign) : String(flightId);
      const origin = f?.origin ? String(f.origin) : '-';
      const destination = f?.destination ? String(f.destination) : '-';
      const ctx = result?.pre_flight_context?.[String(flightId)];
      const takeoffTime = ctx?.takeoff_time || '-';
      const tvArrivalTime = ctx?.tv_arrival_time || '-';
      const tvArrivalSeconds = parseTimeToSeconds(ctx?.tv_arrival_time);
      return { flightId: String(flightId), callsign, origin, destination, delayMinutes, takeoffTime, tvArrivalTime, tvArrivalSeconds };
    });
    rows.sort((a, b) => {
      const da = a.tvArrivalSeconds;
      const db = b.tvArrivalSeconds;
      if (da === db) return a.delayMinutes - b.delayMinutes;
      return da - db; // earliest first; Infinity (unknown) pushed to end
    });
    return rows;
  }, [result, flights]);

  const airportDelayStats = useMemo(() => {
    const delays = result?.delays_by_flight;
    if (!delays) return null;
    const entries = Object.entries(delays);
    if (entries.length === 0) return null;

    const flightsById = buildFlightIdIndex(flights);
    const flightsByCallsign = buildUniqueCallsignIndex(flights);

    type Accumulator = { total: number; count: number; max: number; min: number };
    const depMap = new Map<string, Accumulator>();
    const arrMap = new Map<string, Accumulator>();

    const updateMap = (map: Map<string, Accumulator>, airport: unknown, delay: number) => {
      const key = normalizeAirportLabel(airport);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { total: delay, count: 1, max: delay, min: delay });
      } else {
        existing.total += delay;
        existing.count += 1;
        existing.max = Math.max(existing.max, delay);
        existing.min = Math.min(existing.min, delay);
      }
    };

    let totalDelay = 0;
    let totalFlights = 0;
    let heaviest: HeaviestDelayInfo | null = null;

    for (const [flightKey, rawDelay] of entries) {
      const delayMinutes = Number(rawDelay);
      if (!Number.isFinite(delayMinutes)) continue;
      totalDelay += delayMinutes;
      totalFlights += 1;

      let flight: Trajectory | undefined = flightsById.get(String(flightKey));
      if (!flight && flightsByCallsign.has(String(flightKey))) {
        const resolvedId = flightsByCallsign.get(String(flightKey));
        if (resolvedId) {
          flight = flightsById.get(resolvedId);
        }
      }
      const origin = normalizeAirportLabel(flight?.origin);
      const destination = normalizeAirportLabel(flight?.destination);
      const fallbackCallSign = toTrimmedString(flightKey) || "Unknown";
      const callSign = stringWithFallback(flight?.callSign ?? flightKey, fallbackCallSign);

      updateMap(depMap, origin, delayMinutes);
      updateMap(arrMap, destination, delayMinutes);

      if (!heaviest || delayMinutes > heaviest.delay) {
        heaviest = {
          flightId: String(flightKey),
          callSign,
          origin,
          destination,
          delay: delayMinutes,
        };
      }
    }

    if (totalFlights === 0) return null;

    const toRows = (map: Map<string, Accumulator>): AirportDelayRow[] =>
      Array.from(map.entries())
        .map(([airport, stats]) => ({
          airport,
          flightCount: stats.count,
          totalDelay: stats.total,
          averageDelay: stats.count > 0 ? stats.total / stats.count : 0,
          maxDelay: stats.max,
          minDelay: stats.min,
        }))
        .sort((a, b) => b.totalDelay - a.totalDelay);

    const departures = toRows(depMap);
    const arrivals = toRows(arrMap);

    const combined = new Map<
      string,
      {
        airport: string;
        departureDelay: number;
        arrivalDelay: number;
        departureFlights: number;
        arrivalFlights: number;
      }
    >();
    const ensureCombined = (airport: string) => {
      const key = airport || "Unknown";
      let entry = combined.get(key);
      if (!entry) {
        entry = {
          airport: key,
          departureDelay: 0,
          arrivalDelay: 0,
          departureFlights: 0,
          arrivalFlights: 0,
        };
        combined.set(key, entry);
      }
      return entry;
    };

    for (const row of departures) {
      const target = ensureCombined(row.airport);
      target.departureDelay += row.totalDelay;
      target.departureFlights += row.flightCount;
    }
    for (const row of arrivals) {
      const target = ensureCombined(row.airport);
      target.arrivalDelay += row.totalDelay;
      target.arrivalFlights += row.flightCount;
    }

    const combinedEntries: AirportDelayChartRow[] = Array.from(combined.values()).map((entry) => ({
      airport: entry.airport,
      departureDelay: entry.departureDelay,
      arrivalDelay: entry.arrivalDelay,
      departureFlights: entry.departureFlights,
      arrivalFlights: entry.arrivalFlights,
      total: entry.departureDelay + entry.arrivalDelay,
      totalFlights: entry.departureFlights + entry.arrivalFlights,
    }));
    combinedEntries.sort((a, b) => b.total - a.total || a.airport.localeCompare(b.airport));

    return {
      departures,
      arrivals,
      totalFlights,
      totalDelay,
      averageDelay: totalDelay / totalFlights,
      heaviest,
      combinedEntries,
      chartTotalCount: combinedEntries.length,
      uniqueAirports: combinedEntries.length,
    };
  }, [result?.delays_by_flight, flights]);

  const formatAdaptive = (value: number, fractionDigits = 1) => {
    if (!Number.isFinite(value)) return "—";
    const isInt = Math.abs(value - Math.round(value)) < 1e-6;
    const digits = isInt ? 0 : fractionDigits;
    return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  const formatAverage = (value: number) =>
    Number.isFinite(value) ? value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—";

  const formatFlights = (value: number) => (Number.isFinite(value) ? Math.round(value).toLocaleString() : "0");

  const [airportChartMetric, setAirportChartMetric] = useState<'delay' | 'flights'>('delay');
  const chartLimit = 10;
  const chartData = useMemo(() => {
    if (!airportDelayStats) return [] as AirportDelayChartRow[];
    const entries = airportDelayStats.combinedEntries.slice();
    entries.sort((a, b) => {
      if (airportChartMetric === 'flights') {
        return b.totalFlights - a.totalFlights || a.airport.localeCompare(b.airport);
      }
      return b.total - a.total || a.airport.localeCompare(b.airport);
    });
    return entries.slice(0, chartLimit);
  }, [airportDelayStats, airportChartMetric]);
  const chartTotalCount = airportDelayStats?.combinedEntries.length ?? 0;
  const chartMetricLabel = airportChartMetric === 'delay' ? 'total delay' : 'delayed flights';

  const heaviestDelay = airportDelayStats?.heaviest ?? null;
  const departureRows = airportDelayStats ? airportDelayStats.departures.slice(0, AIRPORT_TABLE_LIMIT) : [];
  const arrivalRows = airportDelayStats ? airportDelayStats.arrivals.slice(0, AIRPORT_TABLE_LIMIT) : [];

  const formatChartValue = (value: number) =>
    airportChartMetric === 'delay' ? formatAdaptive(value, 1) : formatFlights(value);
  const tooltipUnit = airportChartMetric === 'delay' ? 'min' : 'flights';
  const barSeries =
    airportChartMetric === 'delay'
      ? [
          { key: 'departureDelay' as const, name: 'Departure delay', color: '#60a5fa' },
          { key: 'arrivalDelay' as const, name: 'Arrival delay', color: '#f472b6' },
        ]
      : [
          { key: 'departureFlights' as const, name: 'Departure flights', color: '#60a5fa' },
          { key: 'arrivalFlights' as const, name: 'Arrival flights', color: '#f472b6' },
        ];
  const chartSummaryText =
    chartTotalCount === 0
      ? 'No airports with delays yet'
      : chartTotalCount > chartData.length
        ? `Top ${chartData.length} of ${chartTotalCount} airports by ${chartMetricLabel}`
        : `Airports by ${chartMetricLabel} (${chartTotalCount})`;

  const regSnapshotCount = regSnapshotList.length;

  const formatNumber = (value: number | null | undefined, digits = 2) => {
    if (value === null || value === undefined) return "—";
    if (!Number.isFinite(value)) return "∞";
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  };

  const formatSignedNumber = (value: number | null | undefined, digits = 2) => {
    if (value === null || value === undefined) return "—";
    if (!Number.isFinite(value)) return "∞";
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      signDisplay: "always",
    }).format(Number(value));
  };

  const formatSignedPercent = (value: number | null | undefined, digits = 1): string | undefined => {
    if (value === null || value === undefined) return undefined;
    if (!Number.isFinite(value)) return undefined;
    return `${new Intl.NumberFormat(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      signDisplay: "always",
    }).format(Number(value))}%`;
  };

  const baselineObjective = useMemo(
    () => readFiniteNumber(result?.pre_objective),
    [result?.pre_objective],
  );

  const objectiveScore = useMemo(() => readFiniteNumber(result?.objective), [result?.objective]);

  const objectiveImprovement = useMemo(() => {
    const direct = readFiniteNumber(result?.delta_objective);
    if (direct !== null) return direct;
    if (baselineObjective !== null && objectiveScore !== null) {
      const delta = baselineObjective - objectiveScore;
      return Number.isFinite(delta) ? delta : null;
    }
    return null;
  }, [result?.delta_objective, baselineObjective, objectiveScore]);

  const objectiveImprovementPercent = useMemo(() => {
    if (objectiveImprovement === null || baselineObjective === null || baselineObjective === 0) {
      return null;
    }
    const percent = (objectiveImprovement / baselineObjective) * 100;
    return Number.isFinite(percent) ? percent : null;
  }, [objectiveImprovement, baselineObjective]);

  const objectiveImprovementTone: "positive" | "negative" | undefined =
    objectiveImprovement === null
      ? undefined
      : objectiveImprovement > 0
        ? "positive"
        : objectiveImprovement < 0
          ? "negative"
          : undefined;

  const objectiveImprovementSub = useMemo(() => {
    if (objectiveImprovement === null) return undefined;
    const percentLabel = formatSignedPercent(objectiveImprovementPercent, 1);
    if (percentLabel) {
      return `${percentLabel} vs baseline`;
    }
    if (objectiveImprovement > 0) return "Improvement vs baseline";
    if (objectiveImprovement < 0) return "Regression vs baseline";
    return "No change vs baseline";
  }, [objectiveImprovement, objectiveImprovementPercent]);

  const objectiveComponents = useMemo<ObjectiveComponentEntry[]>(() => {
    const components = result?.objective_components;
    if (!components || typeof components !== "object") return [];

    const normalized = new Map<string, { rawKey: string; value: number }>();
    Object.entries(components).forEach(([rawKey, rawValue]) => {
      const numeric = readFiniteNumber(rawValue);
      const normalizedKey = normalizeObjectiveKey(rawKey);
      if (numeric === null || !normalizedKey) return;
      if (!normalized.has(normalizedKey)) {
        normalized.set(normalizedKey, { rawKey, value: numeric });
      }
    });

    const ordered: ObjectiveComponentEntry[] = [];
    OBJECTIVE_COMPONENT_ORDER.forEach((orderKey) => {
      const match = normalized.get(orderKey);
      if (!match) return;
      ordered.push({ key: match.rawKey, normalizedKey: orderKey, value: match.value });
      normalized.delete(orderKey);
    });

    const remaining = Array.from(normalized.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([normKey, match]) => ({ key: match.rawKey, normalizedKey: normKey, value: match.value }));

    return [...ordered, ...remaining];
  }, [result?.objective_components]);

  const legacyObjectiveScore = useMemo(() => readFiniteNumber(result?.legacy_objective), [result?.legacy_objective]);

  const legacyObjectiveComponents = useMemo<ObjectiveComponentEntry[]>(() => {
    const components = result?.legacy_objective_components;
    if (!components || typeof components !== "object") return [];

    return Object.entries(components)
      .map(([rawKey, rawValue]) => {
        const numeric = readFiniteNumber(rawValue);
        if (numeric === null) return null;
        const normalizedKey = normalizeObjectiveKey(rawKey) ?? rawKey;
        return { key: rawKey, normalizedKey, value: numeric };
      })
      .filter((entry): entry is ObjectiveComponentEntry => !!entry)
      .sort((a, b) => a.normalizedKey.localeCompare(b.normalizedKey));
  }, [result?.legacy_objective_components]);

  const weightsUsed = useMemo<WeightEntry[]>(() => {
    const weights = result?.weights_used;
    if (!weights || typeof weights !== "object") return [];

    return Object.entries(weights)
      .map(([key, rawValue]) => {
        const numeric = readFiniteNumber(rawValue);
        if (numeric === null) return null;
        return { key, value: numeric };
      })
      .filter((entry): entry is WeightEntry => !!entry)
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [result?.weights_used]);

  const hasObjectiveComponents = objectiveComponents.length > 0;
  const hasLegacyObjective = legacyObjectiveScore !== null || legacyObjectiveComponents.length > 0;
  const hasWeightsUsed = weightsUsed.length > 0;
  const hasObjectiveMetrics =
    baselineObjective !== null ||
    objectiveScore !== null ||
    objectiveImprovement !== null ||
    hasObjectiveComponents ||
    hasLegacyObjective ||
    hasWeightsUsed;

  const delayStats = result?.delay_stats;
  const delayTotal = useMemo(() => extractDelayMetric(delayStats, "total"), [delayStats]);
  const delayMean = useMemo(() => extractDelayMetric(delayStats, "mean"), [delayStats]);
  const delayMax = useMemo(() => extractDelayMetric(delayStats, "max"), [delayStats]);
  const delayMin = useMemo(() => extractDelayMetric(delayStats, "min"), [delayStats]);

  const delayStatEntries = useMemo(
    () => {
      const entries = [
        { label: "Total Delay", metric: delayTotal },
        { label: "Mean Delay", metric: delayMean },
        { label: "Max Delay", metric: delayMax },
      ].filter(({ metric }) => delayMetricHasValue(metric));

      if (delayMetricHasValue(delayMin)) {
        entries.push({ label: "Min Delay", metric: delayMin });
      }

      return entries;
    },
    [delayTotal, delayMean, delayMax, delayMin],
  );

  const delayedFlightsCount = useMemo(() => {
    if (!delayStats) return null;
    return (
      readFiniteNumber((delayStats as any).num_delayed) ??
      readFiniteNumber((delayStats as any).delayed_flights_count)
    );
  }, [delayStats]);

  const totalFlightsCount = useMemo(() => {
    if (!delayStats) return null;
    return readFiniteNumber((delayStats as any).num_flights);
  }, [delayStats]);

  const hasPositiveDelayAssignments = useMemo(
    () =>
      Object.values(result?.delays_by_flight ?? {}).some((value) => Number(value) > 0),
    [result?.delays_by_flight],
  );

  const commitPreconditionError = useMemo(() => {
    if (!resourceDate) {
      return "Select a resource date before committing regulation state.";
    }
    if (!resourceStateSelectedId || !resourceStateHeadId) {
      return "Resource state history is still loading.";
    }
    if (resourceStateSelectedId !== resourceStateHeadId) {
      return `Select the current head ${resourceStateHeadId} before committing a new episode.`;
    }
    if (!hasPositiveDelayAssignments) {
      return "No positive delay assignments are available to commit.";
    }
    return null;
  }, [
    hasPositiveDelayAssignments,
    resourceDate,
    resourceStateHeadId,
    resourceStateSelectedId,
  ]);

  const handlePerAccAttribModeChange = async (nextMode: RegulationPlanPerAccAttribMode) => {
    const currentResultMode = normalizePerAccAttribMode(result?.per_acc_attrib?.mode);
    if (perAccAttribLoading) return;
    if (nextMode === currentResultMode) {
      setPerAccAttribMode(currentResultMode);
      setPerAccAttribError(null);
      return;
    }
    if (!Array.isArray(regulations) || regulations.length === 0) {
      setPerAccAttribMode(currentResultMode);
      setPerAccAttribError("No regulations are available to re-run the simulation.");
      return;
    }

    setPerAccAttribMode(nextMode);
    setPerAccAttribError(null);
    setPerAccAttribLoading(true);

    try {
      const nextResult = await simulateRegulationPlan({
        regulations,
        perAccAttribMode: nextMode,
        currentContext: currentRegulationContext,
      });
      setRegulationSimulationResult(nextResult);
    } catch (err) {
      console.error(err);
      setPerAccAttribMode(currentResultMode);
      setPerAccAttribError(err instanceof Error ? err.message : "Failed to refresh ACC attribution.");
    } finally {
      setPerAccAttribLoading(false);
    }
  };

  const handleOpenRegSnapshotPrompt = () => {
    if (!result) return;
    const current = loadRegSnapshots();
    setRegSnapshotList(current);
    const defaultDescription = `Regulation Plan ${current.length + 1}`;
    setRegSnapshotDescription(defaultDescription);
    if (current.length >= MAX_REG_SNAPSHOTS) {
      setRegSnapshotReplaceId(current[0]?.id ?? null);
    } else {
      setRegSnapshotReplaceId(null);
    }
    setRegSnapshotSaveError(null);
    setRegSnapshotPromptOpen(true);
  };

  const handleSaveRegSnapshot = () => {
    if (!result) return;
    if (regSnapshotList.length >= MAX_REG_SNAPSHOTS && !regSnapshotReplaceId) {
      setRegSnapshotSaveError(`You already have ${MAX_REG_SNAPSHOTS} snapshots. Select one to replace or delete an existing snapshot.`);
      return;
    }
    setRegSnapshotSaving(true);
    setRegSnapshotSaveError(null);
    const saveSnapshot = async () => {
      const description = regSnapshotDescription.trim() || `Regulation Plan ${regSnapshotList.length + 1}`;
      const perAccAttribByMode: StoredPerAccAttribByMode = {};
      const currentPerAccAttrib = clonePerAccAttrib(result.per_acc_attrib);
      if (currentPerAccAttrib) {
        perAccAttribByMode[normalizePerAccAttribMode(currentPerAccAttrib.mode)] = currentPerAccAttrib;
      }

      for (const mode of PER_ACC_COMPARISON_MODES) {
        if (perAccAttribByMode[mode]) continue;
        const refreshedResult = await simulateRegulationPlan({
          regulations,
          perAccAttribMode: mode,
          currentContext: currentRegulationContext,
        });
        const nextAttrib = clonePerAccAttrib(refreshedResult.per_acc_attrib);
        if (!nextAttrib) {
          throw new Error(`ACC attribution is unavailable for ${mode.replace(/_/g, " ")} mode.`);
        }
        perAccAttribByMode[mode] = nextAttrib;
      }

      const snapshot = createRegulationSnapshot({
        description,
        result,
        perAccAttribByMode,
        sourceRoute: "regulations",
      });
      const next = addRegSnapshot(snapshot, { replaceId: regSnapshotReplaceId || undefined });
      setRegSnapshotList(next);
      setRegSnapshotPromptOpen(false);
      setRegSnapshotReplaceId(null);
      setRegSnapshotDescription(`Regulation Plan ${next.length + 1}`);
      setRegSnapshotToast({
        kind: "success",
        message: `Saved "${snapshot.description}" for comparison.`,
        action: { label: "Open Comparison", href: "/regulation-comparison" },
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("reg-snapshot-changed"));
      }
    };

    void saveSnapshot()
      .catch((err: any) => {
        if (err instanceof RegSnapshotLimitError) {
          setRegSnapshotSaveError(`Only ${err.limit} snapshots can be stored. Select one to replace or remove an existing snapshot.`);
        } else {
          setRegSnapshotSaveError(err?.message || "Failed to save snapshot.");
        }
      })
      .finally(() => {
        setRegSnapshotSaving(false);
      });
  };

  const cleanupAfterCommit = () => {
    useSimStore.setState({ regulations: [] });
    setRegulationEditPayload(null);
    setIsRegulationPanelOpen(false);
    clearRegulationTargetFlights();
  };

  const handleCommitRegulation = async () => {
    if (!result) return;
    if (commitRegulationPending || resourceStateLoading) return;

    setCommitRegulationError(null);

    if (commitPreconditionError) {
      setCommitRegulationError(commitPreconditionError);
      return;
    }

    const parentStateId = resourceStateHeadId ?? resourceStateSelectedId ?? "";
    let commitPayload;
    try {
      commitPayload = buildResourceStateHistoryCommitFromSimulation({
        parentStateId,
        regulations,
        result,
        flights,
      });
    } catch (error) {
      setCommitRegulationError(
        error instanceof Error
          ? error.message
          : "Failed to prepare regulation commit payload.",
      );
      return;
    }

    setCommitRegulationPending(true);
    setResourceStateError(null);
    setResourceStatePendingId(parentStateId);
    setResourceStateLoading(true);

    let commitSucceeded = false;
    let committedStateId: string | null = null;

    try {
      const commitResponse = await commitResourceStateHistory(commitPayload);
      commitSucceeded = true;
      committedStateId =
        typeof (commitResponse as any)?.state?.state_id === "string"
          ? String((commitResponse as any).state.state_id).trim()
          : null;
      await refreshFromServer();
      cleanupAfterCommit();
    } catch (error) {
      if (error instanceof ResourceDateOutOfSyncError) {
        return;
      }

      console.error("Failed to commit regulation:", error);

      let recoveredByRefresh = false;
      try {
        await refreshFromServer();
        recoveredByRefresh = true;
      } catch (refreshError) {
        if (!(refreshError instanceof ResourceDateOutOfSyncError)) {
          console.error(
            "Failed to refresh resource state after regulation commit error:",
            refreshError,
          );
        }
      }

      if (commitSucceeded && recoveredByRefresh) {
        cleanupAfterCommit();
        return;
      }

      if (commitSucceeded) {
        const baseMessage =
          error instanceof Error
            ? error.message
            : "Failed to synchronize client state after commit.";
        setCommitRegulationError(
          committedStateId
            ? `Regulation committed as ${committedStateId}, but client synchronization failed. ${baseMessage}`
            : `Regulation committed, but client synchronization failed. ${baseMessage}`,
        );
        return;
      }

      setCommitRegulationError(
        error instanceof Error ? error.message : "Failed to commit regulation.",
      );
    } finally {
      setCommitRegulationPending(false);
      setResourceStatePendingId(null);
      setResourceStateLoading(false);
    }
  };

  if (!open || !result) return null;

  return (
    <>
      <ModalDialog open={open} onClose={onClose} title="Simulation Results" description="Post-regulation occupancy, delay stats, and per-flight details" width="w-[calc(100vw-3rem)]" height="h-[calc(100vh-3rem)]">
        <div className="p-6 space-y-6">
        {/* Delay stats */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="text-sm uppercase tracking-wider text-gray-300">Delay Stats</div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={handleOpenRegSnapshotPrompt}
                disabled={regSnapshotSaving}
                className={`h-7 px-3 rounded-lg border text-xs flex items-center gap-2 ${regSnapshotSaving ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100' : 'border-emerald-400/70 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/25'}`}
              >
                {regSnapshotSaving ? <ShimmeringText text="Saving…" /> : "Add to Comparison"}
                <span className={`px-2 py-0.5 rounded-full text-[11px] border ${regSnapshotSizeWarn ? 'border-amber-300/70 bg-amber-500/20 text-amber-100' : 'border-emerald-300/70 bg-emerald-400/10 text-emerald-100'}`}>
                  {regSnapshotCount}/{MAX_REG_SNAPSHOTS}
                </span>
              </button>
              <div className="relative group">
                <button
                  type="button"
                  onClick={() => void handleCommitRegulation()}
                  disabled={commitRegulationPending || resourceStateLoading || !!commitPreconditionError}
                  className={`h-7 px-3 rounded-lg border text-xs flex items-center gap-1.5 ${commitRegulationPending || resourceStateLoading || !!commitPreconditionError ? 'border-sky-300/30 bg-sky-500/10 text-sky-100/60 cursor-not-allowed' : 'border-sky-300/70 bg-sky-500/20 text-sky-50 hover:bg-sky-500/30'}`}
                >
                  <svg className="w-3 h-3 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8V2M3.5 4.5 6 2l2.5 2.5"/><path d="M2 9.5v.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-.5"/></svg>
                  {commitRegulationPending ? <ShimmeringText text="Committing…" /> : "Commit Regulation"}
                </button>
                <div className="pointer-events-none absolute bottom-full right-0 mb-1.5 hidden group-hover:flex flex-col gap-0.5 min-w-max rounded-lg border border-white/15 bg-gray-900/95 px-3 py-2 text-[11px] shadow-xl z-50">
                  <div className="text-white/60">
                    Selected state: <span className="font-mono text-white/85">{resourceStateSelectedId ?? "—"}</span>
                  </div>
                  <div className="text-white/60">
                    Head: <span className="font-mono text-white/85">{resourceStateHeadId ?? "—"}</span>
                  </div>
                  <div className="text-white/45 mt-0.5">Commit appends this regulation episode on the server and re-synchronizes the selected state.</div>
                </div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {delayStatEntries.map(({ label, metric }) => (
              <Stat
                key={label}
                label={label}
                value={formatDelayMetricValue(metric, formatNumber)}
                sub={formatDelayMetricSub(metric)}
              />
            ))}
            <Stat
              label="Delayed Flights"
              value={
                delayedFlightsCount !== null
                  ? Math.round(delayedFlightsCount).toLocaleString()
                  : "—"
              }
            />
            <Stat
              label="Flights"
              value={
                totalFlightsCount !== null ? Math.round(totalFlightsCount).toLocaleString() : "—"
              }
            />
          </div>
          {(commitRegulationError || commitPreconditionError) && (
            <div className={`mt-3 mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] ${commitRegulationError ? 'border-rose-400/30 bg-rose-500/10 text-rose-300' : 'border-amber-400/30 bg-amber-500/10 text-amber-200'}`}>
              {commitRegulationError ? (
                <svg className="w-3.5 h-3.5 shrink-0 mt-px" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="5.5"/><path d="M5 5l4 4m0-4-4 4"/></svg>
              ) : (
                <svg className="w-3.5 h-3.5 shrink-0 mt-px" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 1.5 12.5 11.5H1.5L7 1.5Z"/><path d="M7 5.5v2.5"/><circle cx="7" cy="9.5" r=".5" fill="currentColor" stroke="none"/></svg>
              )}
              <span>{commitRegulationError ?? commitPreconditionError}</span>
            </div>
          )}
        </div>

        {hasObjectiveMetrics && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <div className="text-sm uppercase tracking-wider text-gray-300">Objective Function</div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <Stat
                label="Baseline Objective"
                value={
                  baselineObjective !== null ? formatNumber(baselineObjective, 2) : "—"
                }
                sub={baselineObjective !== null ? "Pre-regulation" : undefined}
              />
              <Stat
                label="Optimized Objective"
                value={objectiveScore !== null ? formatNumber(objectiveScore, 2) : "—"}
                sub={objectiveScore !== null ? "Post-regulation" : undefined}
              />
              <Stat
                label="Improvement"
                value={formatSignedNumber(objectiveImprovement, 2)}
                sub={objectiveImprovementSub}
                tone={objectiveImprovementTone}
              />
              {hasLegacyObjective && (
                <Stat
                  label="Legacy Objective"
                  value={legacyObjectiveScore !== null ? formatNumber(legacyObjectiveScore, 2) : "—"}
                  sub={legacyObjectiveScore !== null ? "Legacy scoring" : undefined}
                />
              )}
            </div>
            {hasObjectiveComponents && (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm text-white/80">
                  <thead className="text-white/60 text-[12px] uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-3 py-2">Component</th>
                      <th className="text-right px-3 py-2">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {objectiveComponents.map((entry) => (
                      <tr key={entry.normalizedKey} className="border-t border-white/10">
                        <td className="px-3 py-2 text-white/80">{entry.key}</td>
                        <td className="px-3 py-2 text-right font-mono text-white/90">
                          {formatNumber(entry.value, 3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {hasLegacyObjective && legacyObjectiveComponents.length > 0 && (
              <div className="mt-6">
                <button
                  type="button"
                  className="w-full flex items-center justify-between text-xs uppercase tracking-wider text-white/60 hover:text-white transition-colors mb-2"
                  onClick={() => setShowLegacyComponents((v) => !v)}
                  aria-controls="legacy-components-content"
                  aria-expanded={showLegacyComponents}
                >
                  <span>Legacy Components</span>
                  <svg
                    className={`w-4 h-4 text-white/70 transition-transform ${showLegacyComponents ? "rotate-90" : ""}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.21 5.23a.75.75 0 011.06 0l4.5 4.5a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 01-1.06-1.06L10.94 10 7.21 6.29a.75.75 0 010-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
                <div
                  className={`overflow-x-auto${showLegacyComponents ? "" : " hidden"}`}
                  id="legacy-components-content"
                  aria-hidden={!showLegacyComponents}
                >
                  <table className="min-w-full text-sm text-white/80">
                    <thead className="text-white/60 text-[12px] uppercase tracking-wider">
                      <tr>
                        <th className="text-left px-3 py-2">Component</th>
                        <th className="text-right px-3 py-2">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {legacyObjectiveComponents.map((entry) => (
                        <tr key={`legacy-${entry.normalizedKey}`} className="border-t border-white/10">
                          <td className="px-3 py-2 text-white/70">{entry.key}</td>
                          <td className="px-3 py-2 text-right font-mono text-white/80">
                            {formatNumber(entry.value, 3)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {hasWeightsUsed && (
              <div className="mt-6">
                <button
                  type="button"
                  className="w-full flex items-center justify-between text-xs uppercase tracking-wider text-white/60 hover:text-white transition-colors mb-2"
                  onClick={() => setShowObjectiveWeights((v) => !v)}
                  aria-controls="objective-weights-content"
                  aria-expanded={showObjectiveWeights}
                >
                  <span>Objective Weights Applied</span>
                  <svg
                    className={`w-4 h-4 text-white/70 transition-transform ${showObjectiveWeights ? "rotate-90" : ""}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.21 5.23a.75.75 0 011.06 0l4.5 4.5a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 01-1.06-1.06L10.94 10 7.21 6.29a.75.75 0 010-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
                <div
                  className={`overflow-x-auto${showObjectiveWeights ? "" : " hidden"}`}
                  id="objective-weights-content"
                  aria-hidden={!showObjectiveWeights}
                >
                  <table className="min-w-full text-sm text-white/80">
                    <thead className="text-white/60 text-[12px] uppercase tracking-wider">
                      <tr>
                        <th className="text-left px-3 py-2">Weight</th>
                        <th className="text-right px-3 py-2">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weightsUsed.map((entry) => (
                        <tr key={`weight-${entry.key}`} className="border-t border-white/10">
                          <td className="px-3 py-2 text-white/70">{entry.key}</td>
                          <td className="px-3 py-2 text-right font-mono text-white/80">
                            {formatNumber(entry.value, 3)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Rolling-hour Occupancy Diff with time control and sort */}
        <div>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <div className="text-sm uppercase tracking-wider text-gray-300">Rolling-hour Occupancy Diff (Post vs Pre)</div>
            <div className="ml-auto flex items-center gap-2">
              <div className="text-[11px] uppercase tracking-wider text-white/60">TV Sort</div>
              {(() => {
                const tvs = (result as any)?.rolling_changed_tvs ?? result?.rolling_top_tvs ?? [];
                const hasBoth = tvs.some((tv: any) => Array.isArray(tv?.pre_rolling_counts) && Array.isArray(tv?.post_rolling_counts));
                const hasCap = tvs.some((tv: any) => Array.isArray(tv?.capacity_per_bin) && tv.capacity_per_bin.length > 0);
                return (
                  <select
                    className="px-2 py-1 text-[12px] rounded-md bg-white/10 border border-white/20 text-white/90 focus:outline-none"
                    value={sortMode}
                    onChange={(e) => setSortMode(e.currentTarget.value as OccupancyPrePostSortMode)}
                  >
                    <option value="total">Rank by Total</option>
                    <option value="abs_change" disabled={!hasBoth}>Rank by Absolute Changes</option>
                    <option value="relative_change" disabled={!hasBoth}>Rank by Relative Changes</option>
                    <option value="total_excess_reduced" disabled={!hasBoth || !hasCap}>Total Excess Reduced</option>
                    <option value="total_excess_induced" disabled={!hasBoth || !hasCap}>Total Excess Induced</option>
                    <option value="exceedance" disabled={!hasCap}>By Exceedances</option>
                  </select>
                );
              })()}
            </div>
          </div>
          <TimeScaleControl
            time_from={viewFrom}
            time_to={viewTo}
            onCommit={(f, t) => { setViewFrom(f); setViewTo(t); }}
            className="mb-3"
          />
          {(() => {
            const tvs = (result as any)?.rolling_changed_tvs ?? result?.rolling_top_tvs ?? [];
            const preCounts: Record<string, number[]> = {};
            const postCounts: Record<string, number[]> = {};
            const capacity: Record<string, number[]> = {};
            for (const tv of tvs) {
              const id = String(tv.traffic_volume_id);
              preCounts[id] = Array.isArray(tv.pre_rolling_counts) ? tv.pre_rolling_counts : [];
              postCounts[id] = Array.isArray(tv.post_rolling_counts) ? tv.post_rolling_counts : [];
              if (Array.isArray(tv.capacity_per_bin)) {
                // Filter out capacity values >998 so they don't affect y-axis scaling
                // Values >998 (like 9999 for unopened traffic volumes) are set to NaN
                // which will be treated as null in OccupancyPrePostPanel
                capacity[id] = tv.capacity_per_bin.map((cap: number) => 
                  Number.isFinite(cap) && cap > 998 ? NaN : cap
                );
              }
            }
            const binMinutes = Number(result?.metadata?.time_bin_minutes ?? 15);
            const tvOrder = Object.keys(postCounts).sort((a, b) => {
              const na = Math.min((preCounts[a] || []).length, (postCounts[a] || []).length);
              let sa = 0; for (let i = 0; i < na; i++) sa += Math.abs((postCounts[a][i] || 0) - (preCounts[a][i] || 0));
              const nb = Math.min((preCounts[b] || []).length, (postCounts[b] || []).length);
              let sb = 0; for (let i = 0; i < nb; i++) sb += Math.abs((postCounts[b][i] || 0) - (preCounts[b][i] || 0));
              if (sa !== sb) return sb - sa;
              return a.localeCompare(b);
            });
            return (
              <OccupancyPrePostPanel
                postCounts={postCounts}
                preCounts={preCounts}
                capacity={Object.keys(capacity).length > 0 ? capacity : undefined}
                hotspotDiffs={result}
                tvOrder={tvOrder}
                binMinutes={binMinutes}
                viewFrom={viewFrom}
                viewTo={viewTo}
                sortMode={sortMode}
                defaultSortMode="abs_change"
                initialLimit={12}
                showReliefMap
                reliefMapTitle="Traffic Volume Relief Map"
                compact
              />
            );
          })()}
        </div>

        <PerAccDelayAttributionPanel
          perAccAttrib={result?.per_acc_attrib}
          mode={perAccAttribMode}
          loading={perAccAttribLoading}
          error={perAccAttribError}
          onModeChange={handlePerAccAttribModeChange}
          variant="dialog"
          unavailableMessage="ACC attribution is unavailable for this simulation response. Switch attribution mode to re-run and request per-ACC attribution."
        />

        {/* Airports Delay Attributions */}
        <div>
          <div className="text-sm uppercase tracking-wider text-gray-300 mb-3">Airports Delay Attributions</div>
          {airportDelayStats ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Flights with delay</div>
                  <div className="text-2xl font-semibold text-white">{formatFlights(airportDelayStats.totalFlights)}</div>
                  <div className="text-[12px] text-white/60 mt-1">{airportDelayStats.uniqueAirports} airports observed</div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Average delay per flight</div>
                  <div className="text-2xl font-semibold text-white">{formatAverage(airportDelayStats.averageDelay)} min</div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Total delay minutes</div>
                  <div className="text-2xl font-semibold text-white">{formatAdaptive(airportDelayStats.totalDelay, 1)} min</div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Heaviest delay</div>
                  <div className="text-2xl font-semibold text-white">
                    {heaviestDelay ? `${formatAdaptive(heaviestDelay.delay, 1)} min` : "—"}
                  </div>
                  {heaviestDelay && (
                    <div className="text-[12px] text-white/60 mt-1">
                      {heaviestDelay.origin} → {heaviestDelay.destination} ({heaviestDelay.callSign})
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="text-[11px] uppercase tracking-wider text-white/60">Airport delay comparison</div>
                  <div className="flex items-center gap-3 text-[11px] text-white/60">
                    <select
                      aria-label="Select airport delay comparison metric"
                      className="h-8 px-3 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15 transition-colors text-[12px]"
                      value={airportChartMetric}
                      onChange={(event) => setAirportChartMetric(event.currentTarget.value as 'delay' | 'flights')}
                    >
                      <option value="delay">Total delay (min)</option>
                      <option value="flights">Delayed flights</option>
                    </select>
                    <div>{chartSummaryText}</div>
                  </div>
                </div>
                {chartData.length > 0 ? (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                        <XAxis
                          dataKey="airport"
                          tick={{ fontSize: 11, fill: "#e2e8f0" }}
                          axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: "#e2e8f0" }}
                          tickFormatter={(value: number) => formatChartValue(value)}
                          axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                          tickLine={false}
                          allowDecimals={airportChartMetric === 'delay'}
                        />
                        <Tooltip
                          formatter={(value: number, name: string) => [
                            `${formatChartValue(Number(value))} ${tooltipUnit}`,
                            name === 'departureDelay'
                              ? 'Departure delay'
                              : name === 'arrivalDelay'
                                ? 'Arrival delay'
                                : name === 'departureFlights'
                                  ? 'Departure flights'
                                  : name === 'arrivalFlights'
                                    ? 'Arrival flights'
                                    : name,
                          ]}
                          contentStyle={{
                            background: "rgba(15,23,42,0.95)",
                            border: "1px solid rgba(255,255,255,0.15)",
                            borderRadius: 8,
                            color: "white",
                          }}
                          itemStyle={{ color: "white" }}
                          labelStyle={{ color: "white" }}
                        />
                        <Legend wrapperStyle={{ color: "#f8fafc" }} />
                        {barSeries.map((series) => (
                          <Bar key={series.key} dataKey={series.key} name={series.name} fill={series.color} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="text-sm text-white/70">No airports to visualize.</div>
                )}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-white/60 mb-2">Delays by departure airport</div>
                  <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                    {departureRows.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm text-white/90">
                          <thead className="bg-white/5 text-white/70">
                            <tr>
                              <th className="text-left px-3 py-2">Airport</th>
                              <th className="text-right px-3 py-2">Flights</th>
                              <th className="text-right px-3 py-2">Total Delay (min)</th>
                              <th className="text-right px-3 py-2">Avg (min)</th>
                              <th className="text-right px-3 py-2">Max (min)</th>
                              <th className="text-right px-3 py-2">Min (min)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {departureRows.map((row, idx) => (
                              <tr
                                key={`dep-${row.airport}-${idx}`}
                                className={`border-t border-white/10 ${idx % 2 === 1 ? 'bg-white/5' : 'bg-white/0'} hover:bg-white/10`}
                              >
                                <td className="px-3 py-2 font-medium text-white">{row.airport}</td>
                                <td className="px-3 py-2 text-right font-mono text-white/90">{formatFlights(row.flightCount)}</td>
                                <td className="px-3 py-2 text-right font-mono text-white/90">{formatAdaptive(row.totalDelay, 1)}</td>
                                <td className="px-3 py-2 text-right font-mono text-white/90">{formatAverage(row.averageDelay)}</td>
                                <td className="px-3 py-2 text-right font-mono text-white/90">{formatAdaptive(row.maxDelay, 1)}</td>
                                <td className="px-3 py-2 text-right font-mono text-white/90">{formatAdaptive(row.minDelay, 1)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="p-4 text-sm text-white/70">No departure delays recorded.</div>
                    )}
                  </div>
                  {airportDelayStats.departures.length > AIRPORT_TABLE_LIMIT && (
                    <div className="mt-2 text-[11px] text-white/60">
                      Showing top {AIRPORT_TABLE_LIMIT} of {airportDelayStats.departures.length} airports.
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-white/60 mb-2">Delays by arrival airport</div>
                  <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                    {arrivalRows.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm text-white/90">
                          <thead className="bg-white/5 text-white/70">
                            <tr>
                              <th className="text-left px-3 py-2">Airport</th>
                              <th className="text-right px-3 py-2">Flights</th>
                              <th className="text-right px-3 py-2">Total Delay (min)</th>
                              <th className="text-right px-3 py-2">Avg (min)</th>
                              <th className="text-right px-3 py-2">Max (min)</th>
                              <th className="text-right px-3 py-2">Min (min)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {arrivalRows.map((row, idx) => (
                              <tr
                                key={`arr-${row.airport}-${idx}`}
                                className={`border-t border-white/10 ${idx % 2 === 1 ? 'bg-white/5' : 'bg-white/0'} hover:bg-white/10`}
                              >
                                <td className="px-3 py-2 font-medium text-white">{row.airport}</td>
                                <td className="px-3 py-2 text-right font-mono text-white/90">{formatFlights(row.flightCount)}</td>
                                <td className="px-3 py-2 text-right font-mono text-white/90">{formatAdaptive(row.totalDelay, 1)}</td>
                                <td className="px-3 py-2 text-right font-mono text-white/90">{formatAverage(row.averageDelay)}</td>
                                <td className="px-3 py-2 text-right font-mono text-white/90">{formatAdaptive(row.maxDelay, 1)}</td>
                                <td className="px-3 py-2 text-right font-mono text-white/90">{formatAdaptive(row.minDelay, 1)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="p-4 text-sm text-white/70">No arrival delays recorded.</div>
                    )}
                  </div>
                  {airportDelayStats.arrivals.length > AIRPORT_TABLE_LIMIT && (
                    <div className="mt-2 text-[11px] text-white/60">
                      Showing top {AIRPORT_TABLE_LIMIT} of {airportDelayStats.arrivals.length} airports.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-xs text-gray-300">
              No delay assignments available to attribute by airport.
            </div>
          )}
        </div>


        {/* Delay assignment table */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm uppercase tracking-wider text-gray-300">Delay Assignment</div>
            <FlightStatisticsButton
              flightIds={delayRows.map((row) => row.flightId)}
              buttonClassName="border-white/20 text-white/80"
            />
          </div>
          {delayRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[900px] whitespace-nowrap">
                <thead>
                  <tr className="text-left border-b border-white/10">
                    <th className="p-2 font-semibold">Flight ID</th>
                    <th className="p-2 font-semibold">CS</th>
                    <th className="p-2 font-semibold">Ori.</th>
                    <th className="p-2 font-semibold">Des.</th>
                    <th className="p-2 font-semibold">T/O</th>
                    <th className="p-2 font-semibold">TV Arr.</th>
                    <th className="p-2 font-semibold">Delay (m)</th>
                  </tr>
                </thead>
                <tbody>
                  {delayRows.map((r) => (
                    <tr key={r.flightId} className="border-b border-white/10 hover:bg-white/5">
                      <td className="p-2 font-mono">{r.flightId}</td>
                      <td className="p-2 font-mono">{r.callsign}</td>
                      <td className="p-2 font-mono">{r.origin}</td>
                      <td className="p-2 font-mono">{r.destination}</td>
                      <td className="p-2 font-mono">{r.takeoffTime}</td>
                      <td className="p-2 font-mono">{r.tvArrivalTime}</td>
                      <td className="p-2 font-mono">{Math.round(r.delayMinutes).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-gray-300">No delay assignments.</div>
          )}
        </div>
        
        </div>
      </ModalDialog>

      <ModalDialog
        open={regSnapshotPromptOpen}
        onClose={() => { if (!regSnapshotSaving) setRegSnapshotPromptOpen(false); }}
        title="Save Regulation Snapshot"
        description="Store occupancy and delay details for side-by-side comparison"
        width="w-[min(520px,95vw)]"
        height="h-auto max-h-[85vh]"
      >
        <div className="p-6 space-y-4 text-sm">
          <p className="text-white/80 text-[13px]">
            Save rolling-hour occupancy, delay stats, and per-flight delays to compare across regulation plans later.
          </p>
          <div className="space-y-2">
            <label className="block text-white/70 text-[12px] uppercase tracking-[0.08em]">Description</label>
            <input
              type="text"
              value={regSnapshotDescription}
              onChange={(e) => setRegSnapshotDescription(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !regSnapshotSaving) {
                  e.preventDefault();
                  handleSaveRegSnapshot();
                }
              }}
              autoFocus
              placeholder="e.g., Evening push mitigation"
              className="w-full px-3 py-2 rounded-md bg-white/10 border border-white/20 text-white focus:border-white/40 outline-none"
            />
          </div>

          {regSnapshotCount >= MAX_REG_SNAPSHOTS && (
            <div className="space-y-2">
              <div className="text-[12px] text-amber-200">
                You already have {regSnapshotCount} snapshots. Select one to replace or cancel.
              </div>
              <select
                value={regSnapshotReplaceId ?? ""}
                onChange={(e) => setRegSnapshotReplaceId(e.currentTarget.value || null)}
                className="w-full px-3 py-2 rounded-md bg-white/10 border border-white/20 text-white focus:border-white/40 outline-none"
              >
                {regSnapshotList.map((snap) => (
                  <option key={snap.id} value={snap.id}>
                    {snap.description || "Untitled"} · {new Date(snap.createdAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="text-[12px] text-white/60">
            Approximate storage used: ~{regSnapshotSizeDisplayKb} KB (limit {MAX_REG_SNAPSHOTS} snapshots).
          </div>

          {regSnapshotSaveError && (
            <div className="text-[12px] text-red-300">{regSnapshotSaveError}</div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              onClick={() => { if (!regSnapshotSaving) setRegSnapshotPromptOpen(false); }}
              disabled={regSnapshotSaving}
              className="px-3 py-1.5 rounded-md border border-white/20 bg-white/5 text-white/80 hover:bg-white/10 text-[13px] disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveRegSnapshot}
              disabled={regSnapshotSaving || (regSnapshotCount >= MAX_REG_SNAPSHOTS && !regSnapshotReplaceId)}
              className="px-4 py-1.5 rounded-md border border-emerald-300 bg-emerald-500/30 text-emerald-50 hover:bg-emerald-500/40 text-[13px] font-medium disabled:opacity-60"
            >
              {regSnapshotSaving ? "Saving…" : "Save Snapshot"}
            </button>
          </div>
        </div>
      </ModalDialog>

      {regSnapshotToast && (
        <div
          className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm flex items-start gap-3 ${regSnapshotToast.kind === 'warning' ? 'bg-amber-500/15 border-amber-300/60 text-amber-100' : 'bg-emerald-500/15 border-emerald-300/60 text-emerald-100'}`}
        >
          <div className="flex-1 text-sm">
            <div>{regSnapshotToast.message}</div>
            {regSnapshotToast.action && (
              <a
                href={regSnapshotToast.action.href}
                className="mt-1 inline-flex items-center gap-1 text-[12px] underline"
              >
                {regSnapshotToast.action.label}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14"></path>
                  <path d="M12 5l7 7-7 7"></path>
                </svg>
              </a>
            )}
          </div>
          <button
            onClick={() => setRegSnapshotToast(null)}
            className="text-[12px] text-white/70 hover:text-white"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "negative";
}) {
  const containerToneClass =
    tone === "positive"
      ? "bg-emerald-500/10 border border-emerald-400/50"
      : tone === "negative"
        ? "bg-rose-500/10 border border-rose-400/50"
        : "bg-slate-900/30 border border-white/10";
  const valueToneClass =
    tone === "positive"
      ? "text-emerald-300"
      : tone === "negative"
        ? "text-rose-300"
        : "text-white";
  const subToneClass = tone ? "text-xs text-white/80" : "text-xs text-gray-300";

  return (
    <div className={`rounded-lg p-3 ${containerToneClass}`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`text-lg font-semibold ${valueToneClass}`}>{value}</div>
      {sub && <div className={subToneClass}>{sub}</div>}
    </div>
  );
}
