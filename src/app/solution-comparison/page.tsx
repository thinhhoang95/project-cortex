"use client";

import { useEffect, useMemo, useState } from "react";
import { useResourceDateGuard } from "@/components/useResourceDateGuard";
import Header from "@/components/Header";
import TimeScaleControl from "@/components/TimeScaleControl";
import ModalDialog from "@/components/ModalDialog";
import MultiSelectWithChips, { ChipOption } from "@/components/MultiSelectWithChips";
import FlightStatisticsButton from "@/components/FlightStatisticsButton";
import PerAccDelayComparisonPanel from "@/components/PerAccDelayComparisonPanel";
import TrafficVolumeInfoTooltip from "@/components/TrafficVolumeInfoTooltip";
import TrafficVolumeReliefMap from "@/components/TrafficVolumeReliefMap";
import {
  SolutionSnapshot,
  loadSnapshots,
  updateSnapshotDescription,
  deleteSnapshot,
  reorderSnapshots,
  clearSnapshots,
  exportSnapshots,
  importSnapshots,
  MAX_SNAPSHOTS,
  estimateSnapshotsSize,
  SNAPSHOT_SIZE_WARN_THRESHOLD,
  SNAPSHOT_STORAGE_KEY,
} from "@/lib/comparison";
import { useSimStore } from "@/components/useSimStore";
import { useHotspotSettingsStore } from "@/components/useHotspotSettingsStore";
import { resolveHotspotColor } from "@/lib/hotspotColoring";
import { loadTrajectories } from "@/lib/flights";
import { buildUniqueCallsignIndex } from "@/lib/flightIdentity";
import { getFlightsCsvPath } from "@/lib/dataPaths";
import { normalizeCapacity } from "@/lib/capacity";
import { hhmmToMinutesSafe, minutesToHHMM, binIndexToRangeLabel } from "@/lib/time";
import { formatSeeMoreLabel } from "@/lib/seeMoreLess";
import { computeNetDeltaByTv } from "@/lib/trafficVolumeRelief";
import {
  computeOccupancyWindowStatsByTv,
  getOccupancyWindowRange,
  OCCUPANCY_CAPACITY_HIDE_THRESHOLD,
  scoreOccupancyTvWindowStats,
} from "@/lib/occupancyWindowStats";
import TrafficOverloadBar, { TrafficOverloadDatum } from "@/components/TrafficOverloadBar";
import type { RegulationPlanPerAccAttribMode } from "@/lib/models";
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Bar,
  Line,
  Legend,
  RadarChart,
  Radar,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
} from "recharts";

const PALETTE = ["#38bdf8", "#f472b6", "#facc15", "#34d399"];
const ABS_CHANGE_PREFIX = "abs_change:" as const;
const REL_CHANGE_PREFIX = "rel_change:" as const;
const EXCESS_REDUCED_PREFIX = "excess_reduced:" as const;
const EXCESS_INDUCED_PREFIX = "excess_induced:" as const;

type OccupancyScope = "aggregate" | "targets" | "ripples";
type FlightSortMode = "max" | "diff" | "callsign";
type TvSortMode =
  | "exceedance"
  | "peak"
  | "alphabetical"
  | `${typeof ABS_CHANGE_PREFIX}${string}`
  | `${typeof REL_CHANGE_PREFIX}${string}`
  | `${typeof EXCESS_REDUCED_PREFIX}${string}`
  | `${typeof EXCESS_INDUCED_PREFIX}${string}`;

type SnapshotSortPrefix =
  | typeof ABS_CHANGE_PREFIX
  | typeof REL_CHANGE_PREFIX
  | typeof EXCESS_REDUCED_PREFIX
  | typeof EXCESS_INDUCED_PREFIX;

function getPrefixedSnapshotId(
  mode: TvSortMode,
  prefix: SnapshotSortPrefix,
): string | null {
  return mode.startsWith(prefix) ? mode.slice(prefix.length) : null;
}

const getAbsChangeSnapshotId = (mode: TvSortMode) => getPrefixedSnapshotId(mode, ABS_CHANGE_PREFIX);
const getRelativeChangeSnapshotId = (mode: TvSortMode) => getPrefixedSnapshotId(mode, REL_CHANGE_PREFIX);
const getExcessReducedSnapshotId = (mode: TvSortMode) => getPrefixedSnapshotId(mode, EXCESS_REDUCED_PREFIX);
const getExcessInducedSnapshotId = (mode: TvSortMode) => getPrefixedSnapshotId(mode, EXCESS_INDUCED_PREFIX);
const isSnapshotScopedTvSortMode = (mode: TvSortMode) =>
  getAbsChangeSnapshotId(mode) !== null ||
  getRelativeChangeSnapshotId(mode) !== null ||
  getExcessReducedSnapshotId(mode) !== null ||
  getExcessInducedSnapshotId(mode) !== null;

type FlightRow = {
  flightId: string;
  callsign: string;
  origin?: string;
  destination?: string;
  takeoff?: string;
  delays: Array<{ snapshotId: string; value: number | null }>;
  maxDelay: number;
  diffDelay: number;
};

type TvMetrics = {
  tvId: string;
  maxExceedance: number;
  maxPeak: number;
};

type ChangeSortOption = {
  value: TvSortMode;
  label: string;
  disabled: boolean;
  reason?: string;
  snapshotId: string;
};

type SnapshotTvSortScores = {
  absChange: Record<string, number>;
  relativeChange: Record<string, number>;
  excessReduced: Record<string, number>;
  excessInduced: Record<string, number>;
};

type AirportDelayRow = {
  airport: string;
  flightCount: number;
  totalDelay: number;
  averageDelay: number;
  maxDelay: number;
  minDelay: number;
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

type HeaviestDelayInfo = {
  flightId: string;
  callSign: string;
  origin: string;
  destination: string;
  delay: number;
};

type SnapshotAirportStats = {
  departures: AirportDelayRow[];
  arrivals: AirportDelayRow[];
  totalFlights: number;
  totalDelay: number;
  averageDelay: number;
  heaviest: HeaviestDelayInfo | null;
  combinedTotals: AirportDelayChartRow[];
  uniqueAirports: number;
};

type AirportComparisonRow = {
  airport: string;
  combinedTotal: number;
  perSnapshot: Record<string, AirportDelayRow>;
};

const IMPROVEMENT_EPSILON = 1e-6;
const OBJECTIVE_COMPONENT_ORDER = ["J_CAP", "J_DELAY", "J_REG", "J_TV", "J_SHARE", "J_SPILL"] as const;

function toFiniteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeObjectiveKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw
    .toString()
    .trim()
    .replace(/[^0-9a-zA-Z]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_")
    .toUpperCase();
}

function getObjectiveComponentValue(
  components: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  if (!components) return null;
  const target = normalizeObjectiveKey(key);
  if (!target) return null;

  if (Object.prototype.hasOwnProperty.call(components, key)) {
    const direct = toFiniteNumber((components as Record<string, unknown>)[key]);
    if (direct !== null) return direct;
  }

  for (const [rawKey, rawValue] of Object.entries(components)) {
    if (normalizeObjectiveKey(rawKey) === target) {
      const value = toFiniteNumber(rawValue);
      if (value !== null) {
        return value;
      }
    }
  }

  return null;
}

function resolveObjectiveImprovement(
  snapshot: SolutionSnapshot,
): { absolute: number | null; percent: number | null } {
  const baselineScore = snapshot.objective.baseline?.score;
  const optimizedScore = snapshot.objective.optimized?.score;

  let absolute: number | null = null;
  let percent: number | null = null;

  const storedImprovement = snapshot.objective.improvement;
  if (storedImprovement) {
    const abs = Number(storedImprovement.absolute);
    if (Number.isFinite(abs)) {
      absolute = abs;
    }
    const pct = Number(storedImprovement.percent);
    if (Number.isFinite(pct)) {
      percent = pct;
    }
  }

  if (
    absolute === null &&
    typeof baselineScore === "number" &&
    typeof optimizedScore === "number" &&
    Number.isFinite(baselineScore) &&
    Number.isFinite(optimizedScore)
  ) {
    absolute = baselineScore - optimizedScore;
  }

  if (
    percent === null &&
    absolute !== null &&
    typeof baselineScore === "number" &&
    Number.isFinite(baselineScore) &&
    Math.abs(baselineScore) > IMPROVEMENT_EPSILON
  ) {
    percent = (absolute / baselineScore) * 100;
  }

  return { absolute, percent };
}

function formatNumber(val: number | null | undefined, digits = 2) {
  if (val === null || val === undefined || Number.isNaN(val)) return "—";
  if (!Number.isFinite(val)) return "∞";
  return Number(val).toFixed(digits);
}

function toTrimmedString(value: unknown): string {
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
}

function stringWithFallback(value: unknown, fallback: string): string {
  const trimmed = toTrimmedString(value);
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeAirportLabel(value: unknown): string {
  return stringWithFallback(value, "Unknown");
}

function formatAdaptive(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return "—";
  const isInt = Math.abs(value - Math.round(value)) < 1e-6;
  const digits = isInt ? 0 : fractionDigits;
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatAverage(value: number): string {
  return Number.isFinite(value)
    ? Number(value).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : "—";
}

function formatFlights(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString() : "0";
}

export default function SolutionComparisonPage() {
  const hotspotSettings = useHotspotSettingsStore((state) => state.settings);
  const resourceDate = useSimStore((state) => state.resourceDate);
  const { flights, setBaselineFlights } = useSimStore();
  const { hydrated, ready, user } = useResourceDateGuard();

  const [snapshots, setSnapshots] = useState<SolutionSnapshot[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewFrom, setViewFrom] = useState("00:00");
  const [viewTo, setViewTo] = useState("23:59");
  const [seriesView, setSeriesView] = useState<"flights" | "airports" | "acc">("flights");
  const [accAttribMode, setAccAttribMode] = useState<RegulationPlanPerAccAttribMode>("dwelling_spread");
  const [airportChartMetric, setAirportChartMetric] = useState<'delay' | 'flights'>('delay');
  const [tvScope, setTvScope] = useState<OccupancyScope>("aggregate");
  const [tvSort, setTvSort] = useState<TvSortMode>("exceedance");
  const [reliefSnapshotId, setReliefSnapshotId] = useState<string>("");
  const [visibleTvCount, setVisibleTvCount] = useState(6);
  const [selectedTvFilters, setSelectedTvFilters] = useState<string[]>([]);
  const [flightSort, setFlightSort] = useState<FlightSortMode>("max");
  const [flightDelayedOnly, setFlightDelayedOnly] = useState(true);
  const [flightThreshold, setFlightThreshold] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [exportText, setExportText] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const current = loadSnapshots();
    setSnapshots(current);
    setSelectedIds((prev) => {
      if (prev.length > 0) return prev.filter((id) => current.some((s) => s.id === id));
      return current.slice(0, Math.min(2, current.length)).map((s) => s.id);
    });
    const onStorage = (ev: StorageEvent) => {
      if (ev.key && ev.key !== SNAPSHOT_STORAGE_KEY) return;
      const next = loadSnapshots();
      setSnapshots(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (flights.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        if (!resourceDate) throw new Error("No resource date selected");
        const tracks = await loadTrajectories(getFlightsCsvPath(resourceDate));
        if (cancelled) return;
        setBaselineFlights(tracks);
      } catch (e) {
        console.warn("Failed to load flight trajectories for comparison page", e);
      }
    })();
    return () => { cancelled = true; };
  }, [flights.length, resourceDate, setBaselineFlights]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const filtered = prev.filter((id) => snapshots.some((s) => s.id === id));
      if (filtered.length > 0) return filtered;
      return snapshots.slice(0, Math.min(2, snapshots.length)).map((s) => s.id);
    });
  }, [snapshots]);

  const snapshotSizeBytes = useMemo(() => estimateSnapshotsSize(snapshots), [snapshots]);
  const snapshotSizeWarn = snapshotSizeBytes > SNAPSHOT_SIZE_WARN_THRESHOLD;
  const snapshotSizeDisplayKb = Math.max(0, Math.round(snapshotSizeBytes / 1024));

  const selectedSnapshots = useMemo(
    () => selectedIds.map((id) => snapshots.find((s) => s.id === id)).filter(Boolean) as SolutionSnapshot[],
    [selectedIds, snapshots]
  );

  const colorBySnapshotId = useMemo(() => {
    const map = new Map<string, string>();
    selectedSnapshots.forEach((snap, idx) => {
      map.set(snap.id, PALETTE[idx % PALETTE.length]);
    });
    return map;
  }, [selectedSnapshots]);

  const minutesBySnapshot = useMemo(() => {
    const counts = new Map<number, number>();
    selectedSnapshots.forEach((snap) => {
      counts.set(snap.minutesPerBin, (counts.get(snap.minutesPerBin) || 0) + 1);
    });
    let dominant: number | null = null;
    counts.forEach((count, minutes) => {
      if (dominant === null || count > (counts.get(dominant) || 0)) {
        dominant = minutes;
      }
    });
    return {
      dominant,
      mismatched: selectedSnapshots.filter((snap) => dominant !== null && snap.minutesPerBin !== dominant).map((snap) => snap.id),
    };
  }, [selectedSnapshots]);

  const alignedSnapshots = useMemo(() => {
    if (!minutesBySnapshot.dominant) return selectedSnapshots;
    return selectedSnapshots.filter((snap) => snap.minutesPerBin === minutesBySnapshot.dominant);
  }, [selectedSnapshots, minutesBySnapshot]);

  useEffect(() => {
    if (alignedSnapshots.length === 0) {
      if (reliefSnapshotId !== "") setReliefSnapshotId("");
      return;
    }
    if (alignedSnapshots.some((snap) => snap.id === reliefSnapshotId)) return;
    setReliefSnapshotId(alignedSnapshots[0].id);
  }, [alignedSnapshots, reliefSnapshotId]);

  const minutesPerBin = minutesBySnapshot.dominant || (alignedSnapshots[0]?.minutesPerBin ?? 15);
  const viewFromMin = hhmmToMinutesSafe(viewFrom);
  const viewToMin = hhmmToMinutesSafe(viewTo);

  const { flightsById, flightsByCallsign } = useMemo(() => {
    const byId = new Map<string, any>();
    const byCallsign = buildUniqueCallsignIndex(flights);
    for (const fl of flights) {
      if (fl?.flightId) byId.set(String(fl.flightId), fl);
    }
    return { flightsById: byId, flightsByCallsign: byCallsign };
  }, [flights]);

  const flightRows: FlightRow[] = useMemo(() => {
    const rows: FlightRow[] = [];
    const ids = new Set<string>();
    alignedSnapshots.forEach((snap) => {
      const delays = snap.delaysMin || {};
      Object.keys(delays || {}).forEach((fid) => ids.add(String(fid)));
    });
    ids.forEach((fid) => {
      const meta = flightsById.get(fid);
      const delays = alignedSnapshots.map((snap) => ({
        snapshotId: snap.id,
        value: snap.delaysMin?.[fid] != null ? Number(snap.delaysMin?.[fid]) : null,
      }));
      const maxDelay = Math.max(0, ...delays.map((d) => (Number.isFinite(d.value ?? NaN) ? Number(d.value) : 0)));
      const minDelay = Math.min(...delays.map((d) => (Number.isFinite(d.value ?? NaN) ? Number(d.value) : 0)));
      rows.push({
        flightId: fid,
        callsign: meta?.callSign || fid,
        origin: meta?.origin,
        destination: meta?.destination,
        takeoff: meta ? minutesToHHMM(Math.round(meta.t0 / 60)) : undefined,
        delays,
        maxDelay,
        diffDelay: maxDelay - (Number.isFinite(minDelay) ? minDelay : 0),
      });
    });
    let filtered = rows;
    if (flightDelayedOnly) {
      filtered = filtered.filter((row) => row.maxDelay > 0);
    }
    if (flightThreshold > 0) {
      filtered = filtered.filter((row) => row.maxDelay >= flightThreshold);
    }
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
    filtered.sort((a, b) => {
      if (flightSort === "callsign") {
        return collator.compare(a.callsign, b.callsign);
      }
      if (flightSort === "diff") {
        if (b.diffDelay !== a.diffDelay) return b.diffDelay - a.diffDelay;
        return b.maxDelay - a.maxDelay;
      }
      return b.maxDelay - a.maxDelay;
    });
    return filtered;
  }, [alignedSnapshots, flightsById, flightDelayedOnly, flightThreshold, flightSort]);

  const flightColumnStats = useMemo(() => {
    return alignedSnapshots.map((snap) => {
      let total = 0;
      let count = 0;
      flightRows.forEach((row) => {
        const entry = row.delays.find((d) => d.snapshotId === snap.id);
        if (entry && entry.value != null) {
          total += Number(entry.value);
          if (entry.value > 0) count += 1;
        }
      });
      const avg = flightRows.length > 0 ? total / flightRows.length : 0;
      return { snapshotId: snap.id, total, average: avg, delayedCount: count };
    });
  }, [alignedSnapshots, flightRows]);

  const bestFlightTotal = useMemo(() => {
    if (flightColumnStats.length === 0) return null;
    return Math.min(...flightColumnStats.map((s) => s.total));
  }, [flightColumnStats]);

  const bestFlightAverage = useMemo(() => {
    if (flightColumnStats.length === 0) return null;
    return Math.min(...flightColumnStats.map((s) => s.average));
  }, [flightColumnStats]);

  const {
    objectiveRadarData,
    objectiveRadarRawValues,
    objectiveRadarMaxNormalized,
  } = useMemo(() => {
    type RadarDatum = {
      metric: string;
      metricKey: string;
    } & Record<string, number | string>;

    const rows: RadarDatum[] = [];
    const rawValueMap = new Map<string, Map<string, number>>();
    const EPSILON = 1e-6;
    let maxNormalizedValue = 0;

    const metrics: Array<{
      key: "J_DELAY" | "J_REG" | "IMPROVEMENT";
      label: string;
      getter: (snap: SolutionSnapshot) => number | null;
      preferLower: boolean;
    }> = [
      {
        key: "J_DELAY",
        label: "J Delay",
        getter: (snap) => getObjectiveComponentValue(snap.objective.optimized?.components, "J_DELAY"),
        preferLower: true,
      },
      {
        key: "J_REG",
        label: "J Reg",
        getter: (snap) => getObjectiveComponentValue(snap.objective.optimized?.components, "J_REG"),
        preferLower: true,
      },
      {
        key: "IMPROVEMENT",
        label: "Improvement (objective score)",
        getter: (snap) => {
          const { absolute } = resolveObjectiveImprovement(snap);
          return typeof absolute === "number" && Number.isFinite(absolute) ? absolute : null;
        },
        preferLower: false,
      },
    ];

    metrics.forEach((metric) => {
      const rawValues: Array<{ snapshotId: string; value: number }> = [];

      alignedSnapshots.forEach((snap) => {
        const value = metric.getter(snap);
        if (value !== null) {
          rawValues.push({ snapshotId: snap.id, value });
        }
      });

      if (rawValues.length === 0) {
        return;
      }

      const values = rawValues.map((item) => item.value);
      const minValue = Math.min(...values);
      const maxValue = Math.max(...values);
      const span = maxValue - minValue;
      const bestValue = metric.preferLower ? minValue : maxValue;
      const bestMagnitude = Math.abs(bestValue);
      const spanMagnitude = Math.abs(span);

      const row: RadarDatum = {
        metric: metric.label,
        metricKey: metric.key,
      };
      const metricRawValues = new Map<string, number>();

      rawValues.forEach(({ snapshotId, value }) => {
        let normalized: number;

        if (metric.preferLower) {
          if (bestMagnitude > EPSILON) {
            normalized = 100 + ((value - bestValue) / bestMagnitude) * 100;
          } else if (spanMagnitude > EPSILON) {
            normalized = 100 + ((value - bestValue) / spanMagnitude) * 100;
          } else {
            normalized = 100;
          }

          if (normalized < 100 && value >= bestValue - EPSILON) {
            normalized = 100;
          }
          normalized = Math.max(0, normalized);
        } else {
          const delta = bestValue - value;
          if (bestMagnitude > EPSILON) {
            normalized = 100 - (delta / bestMagnitude) * 100;
          } else if (spanMagnitude > EPSILON) {
            normalized = 100 - (delta / spanMagnitude) * 100;
          } else {
            normalized = 100;
          }

          if (normalized > 100 && value <= bestValue + EPSILON) {
            normalized = 100;
          }
          normalized = Math.max(0, normalized);
        }

        const safeNormalized = Number.isFinite(normalized) ? normalized : 0;
        row[snapshotId] = safeNormalized;
        metricRawValues.set(snapshotId, value);
        if (Number.isFinite(safeNormalized)) {
          maxNormalizedValue = Math.max(maxNormalizedValue, safeNormalized);
        }
      });

      rows.push(row);
      rawValueMap.set(metric.key, metricRawValues);
    });

    return {
      objectiveRadarData: rows,
      objectiveRadarRawValues: rawValueMap,
      objectiveRadarMaxNormalized: maxNormalizedValue,
    };
  }, [alignedSnapshots]);

  const objectiveRadarDomainMax = useMemo(() => {
    const base = objectiveRadarMaxNormalized || 100;
    const normalizedMax = Math.max(100, base);
    return Math.ceil(normalizedMax / 25) * 25;
  }, [objectiveRadarMaxNormalized]);

  const airportStatsBySnapshot = useMemo(() => {
    const map = new Map<string, SnapshotAirportStats>();
    alignedSnapshots.forEach((snap) => {
      const delays = snap.delaysMin;
      if (!delays) return;
      const entries = Object.entries(delays);
      if (entries.length === 0) return;

      type Accumulator = { total: number; count: number; max: number; min: number };
      const depMap = new Map<string, Accumulator>();
      const arrMap = new Map<string, Accumulator>();

      const updateMap = (target: Map<string, Accumulator>, airport: unknown, delay: number) => {
        const key = normalizeAirportLabel(airport);
        const existing = target.get(key);
        if (!existing) {
          target.set(key, { total: delay, count: 1, max: delay, min: delay });
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
        const delay = Number(rawDelay);
        if (!Number.isFinite(delay)) continue;
        totalDelay += delay;
        totalFlights += 1;

        let flight = flightsById.get(String(flightKey));
        if (!flight && flightsByCallsign.has(String(flightKey))) {
          const resolvedId = flightsByCallsign.get(String(flightKey));
          if (resolvedId) {
            flight = flightsById.get(String(resolvedId));
          }
        }
        const origin = normalizeAirportLabel(flight?.origin);
        const destination = normalizeAirportLabel(flight?.destination);
        const fallbackCallSign = toTrimmedString(flightKey) || "Unknown";
        const callSign = stringWithFallback(flight?.callSign ?? flightKey, fallbackCallSign);

        updateMap(depMap, origin, delay);
        updateMap(arrMap, destination, delay);

        if (!heaviest || delay > heaviest.delay) {
          heaviest = {
            flightId: String(flightKey),
            callSign,
            origin,
            destination,
            delay,
          };
        }
      }

      if (totalFlights === 0) return;

      const toRows = (target: Map<string, Accumulator>): AirportDelayRow[] =>
        Array.from(target.entries())
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

      departures.forEach((row) => {
        const target = ensureCombined(row.airport);
        target.departureDelay += row.totalDelay;
        target.departureFlights += row.flightCount;
      });
      arrivals.forEach((row) => {
        const target = ensureCombined(row.airport);
        target.arrivalDelay += row.totalDelay;
        target.arrivalFlights += row.flightCount;
      });

      const combinedTotals: AirportDelayChartRow[] = Array.from(combined.values()).map((entry) => ({
        airport: entry.airport,
        departureDelay: entry.departureDelay,
        arrivalDelay: entry.arrivalDelay,
        departureFlights: entry.departureFlights,
        arrivalFlights: entry.arrivalFlights,
        total: entry.departureDelay + entry.arrivalDelay,
        totalFlights: entry.departureFlights + entry.arrivalFlights,
      }));

      combinedTotals.sort((a, b) => b.total - a.total);

      map.set(snap.id, {
        departures,
        arrivals,
        totalFlights,
        totalDelay,
        averageDelay: totalFlights > 0 ? totalDelay / totalFlights : 0,
        heaviest,
        combinedTotals,
        uniqueAirports: combinedTotals.length,
      });
    });
    return map;
  }, [alignedSnapshots, flightsByCallsign, flightsById]);

  const snapshotsMissingDelayData = useMemo(
    () =>
      alignedSnapshots.filter((snap) => {
        const delays = snap.delaysMin;
        if (!delays) return true;
        return Object.keys(delays).length === 0;
      }),
    [alignedSnapshots]
  );

  type AirportComparisonChartEntry = {
    airport: string;
    combinedDelay: number;
    combinedFlights: number;
    perSnapshot: Record<string, { totalDelay: number; totalFlights: number }>;
  };

  const airportComparisonChart = useMemo(() => {
    const totals = new Map<string, AirportComparisonChartEntry>();
    alignedSnapshots.forEach((snap) => {
      const stats = airportStatsBySnapshot.get(snap.id);
      if (!stats) return;
      stats.combinedTotals.forEach((entry) => {
        const key = entry.airport;
        let record = totals.get(key);
        if (!record) {
          record = { airport: key, combinedDelay: 0, combinedFlights: 0, perSnapshot: {} };
          totals.set(key, record);
        }
        record.perSnapshot[snap.id] = {
          totalDelay: entry.total,
          totalFlights: entry.totalFlights,
        };
        record.combinedDelay += entry.total;
        record.combinedFlights += entry.totalFlights;
      });
    });
    return {
      entries: Array.from(totals.values()),
      totalCount: totals.size,
    };
  }, [alignedSnapshots, airportStatsBySnapshot]);

  const airportChartSeries = useMemo(
    () =>
      alignedSnapshots
        .filter((snap) => airportStatsBySnapshot.has(snap.id))
        .map((snap) => ({
          snapshot: snap,
          key: `metric_${snap.id}`,
          label: snap.description || "Untitled",
          color: colorBySnapshotId.get(snap.id) || "#38bdf8",
        })),
    [alignedSnapshots, airportStatsBySnapshot, colorBySnapshotId]
  );

  const airportChartSeriesLookup = useMemo(() => {
    const map = new Map<string, string>();
    airportChartSeries.forEach((item) => {
      map.set(item.key, item.label);
    });
    return map;
  }, [airportChartSeries]);

  const AIRPORT_CHART_LIMIT = 10;
  const airportChartEntries = airportComparisonChart.entries;
  const airportChartData = useMemo(() => {
    if (airportChartEntries.length === 0) return [] as Array<Record<string, number | string>>;
    const sorted = airportChartEntries.slice().sort((a, b) => {
      if (airportChartMetric === 'flights') {
        return b.combinedFlights - a.combinedFlights || a.airport.localeCompare(b.airport);
      }
      return b.combinedDelay - a.combinedDelay || a.airport.localeCompare(b.airport);
    });
    const top = sorted.slice(0, AIRPORT_CHART_LIMIT);
    return top.map((entry) => {
      const row: Record<string, number | string> = { airport: entry.airport };
      alignedSnapshots.forEach((snap) => {
        const metrics = entry.perSnapshot[snap.id] || { totalDelay: 0, totalFlights: 0 };
        row[`metric_${snap.id}`] =
          airportChartMetric === 'delay' ? metrics.totalDelay : metrics.totalFlights;
      });
      return row;
    });
  }, [airportChartEntries, airportChartMetric, alignedSnapshots]);
  const airportChartTotalCount = airportComparisonChart.totalCount;
  const airportChartMetricLabel = airportChartMetric === 'delay' ? 'combined delay' : 'delayed flights';
  const airportChartSummaryText =
    airportChartTotalCount === 0
      ? 'No airports with delays yet'
      : airportChartTotalCount > airportChartData.length
        ? `Top ${airportChartData.length} of ${airportChartTotalCount} airports by ${airportChartMetricLabel}`
        : `Airports by ${airportChartMetricLabel} (${airportChartTotalCount})`;
  const formatAirportChartValue = (value: number) =>
    airportChartMetric === 'delay' ? formatAdaptive(value, 1) : formatFlights(value);
  const airportChartTooltipUnit = airportChartMetric === 'delay' ? 'min' : 'flights';

  const departureComparison = useMemo(() => {
    const map = new Map<string, AirportComparisonRow>();
    alignedSnapshots.forEach((snap) => {
      const stats = airportStatsBySnapshot.get(snap.id);
      if (!stats) return;
      stats.departures.forEach((row) => {
        const key = row.airport;
        let entry = map.get(key);
        if (!entry) {
          entry = { airport: key, combinedTotal: 0, perSnapshot: {} };
          map.set(key, entry);
        }
        entry.perSnapshot[snap.id] = row;
        entry.combinedTotal += row.totalDelay;
      });
    });
    const rows = Array.from(map.values());
    rows.sort((a, b) => b.combinedTotal - a.combinedTotal);
    const TABLE_LIMIT = 15;
    return { rows: rows.slice(0, TABLE_LIMIT), totalCount: rows.length };
  }, [alignedSnapshots, airportStatsBySnapshot]);

  const arrivalComparison = useMemo(() => {
    const map = new Map<string, AirportComparisonRow>();
    alignedSnapshots.forEach((snap) => {
      const stats = airportStatsBySnapshot.get(snap.id);
      if (!stats) return;
      stats.arrivals.forEach((row) => {
        const key = row.airport;
        let entry = map.get(key);
        if (!entry) {
          entry = { airport: key, combinedTotal: 0, perSnapshot: {} };
          map.set(key, entry);
        }
        entry.perSnapshot[snap.id] = row;
        entry.combinedTotal += row.totalDelay;
      });
    });
    const rows = Array.from(map.values());
    rows.sort((a, b) => b.combinedTotal - a.combinedTotal);
    const TABLE_LIMIT = 15;
    return { rows: rows.slice(0, TABLE_LIMIT), totalCount: rows.length };
  }, [alignedSnapshots, airportStatsBySnapshot]);

  const objectiveComponentKeys = useMemo(() => {
    const normalizedMap = new Map<string, string>();

    alignedSnapshots.forEach((snap) => {
      const baseline = snap.objective.baseline?.components || {};
      const optimized = snap.objective.optimized?.components || {};

      [baseline, optimized].forEach((components) => {
        Object.keys(components || {}).forEach((rawKey) => {
          const normalized = normalizeObjectiveKey(rawKey);
          if (normalized) {
            if (!normalizedMap.has(normalized)) {
              normalizedMap.set(normalized, normalized);
            }
          }
        });
      });
    });

    const ordered: string[] = [];
    OBJECTIVE_COMPONENT_ORDER.forEach((key) => {
      if (normalizedMap.has(key)) {
        ordered.push(key);
        normalizedMap.delete(key);
      }
    });

    const remaining = Array.from(normalizedMap.keys()).sort((a, b) => a.localeCompare(b));
    return [...ordered, ...remaining];
  }, [alignedSnapshots]);

  const bestImprovementAbsolute = useMemo(() => {
    const values = alignedSnapshots
      .map((snap) => resolveObjectiveImprovement(snap).absolute)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (values.length === 0) return null;
    return Math.max(...values);
  }, [alignedSnapshots]);

  const tvSeriesBySnapshot = useMemo(() => {
    const result = new Map<string, Record<string, number[]>>();
    if (tvScope === "aggregate") {
      alignedSnapshots.forEach((snap) => {
        const series: Record<string, number[]> = {};
        const occ = snap.aggregatedOccupancy;
        if (occ) {
          const post = occ.post_counts || {};
          const pre = occ.pre_counts || {};
          const tvIds = new Set<string>([
            ...Object.keys(post || {}),
            ...Object.keys(pre || {}),
          ]);
          tvIds.forEach((tv) => {
            const values = post?.[tv] ?? pre?.[tv] ?? [];
            series[tv] = Array.isArray(values) ? [...values] : [];
          });
        }
        result.set(snap.id, series);
      });
      return result;
    }
    alignedSnapshots.forEach((snap) => {
      const series: Record<string, number[]> = {};
      snap.flows.forEach((flow) => {
        const map = tvScope === "targets" ? flow.targetOccupancyOpt : flow.rippleOccupancyOpt;
        if (!map) return;
        Object.entries(map).forEach(([tv, values]) => {
          if (!Array.isArray(values)) return;
          if (!series[tv]) {
            series[tv] = [...values];
          } else {
            const arr = series[tv];
            for (let i = 0; i < values.length; i++) {
              arr[i] = (arr[i] || 0) + (Number(values[i]) || 0);
            }
          }
        });
      });
      result.set(snap.id, series);
    });
    return result;
  }, [alignedSnapshots, tvScope]);

  const capacityBySnapshot = useMemo(() => {
    const map = new Map<string, Record<string, number[] | undefined>>();
    if (tvScope !== "aggregate") return map;
    alignedSnapshots.forEach((snap) => {
      const occ = snap.aggregatedOccupancy;
      const cap: Record<string, number[] | undefined> = {};
      if (occ?.capacity) {
        Object.keys(occ.capacity).forEach((tv) => {
          cap[tv] = Array.isArray(occ.capacity?.[tv]) ? [...(occ.capacity?.[tv] || [])] : undefined;
        });
      }
      map.set(snap.id, cap);
    });
    return map;
  }, [alignedSnapshots, tvScope]);

  const overloadSegmentsBySnapshot = useMemo(() => {
    const map = new Map<string, Record<string, TrafficOverloadDatum[]>>();
    const binMinutes = Math.max(1, minutesPerBin);
    alignedSnapshots.forEach((snap) => {
      const seriesByTv = tvSeriesBySnapshot.get(snap.id) || {};
      const capByTv = capacityBySnapshot.get(snap.id) || {};
      const segmentsForSnapshot: Record<string, TrafficOverloadDatum[]> = {};
      Object.entries(seriesByTv).forEach(([tvId, series]) => {
        const capacitySeries = (capByTv as Record<string, number[] | undefined>)[tvId] || [];
        const segments: TrafficOverloadDatum[] = [];
        for (let i = 0; i < series.length; i++) {
          const startMin = i * binMinutes;
          if (startMin < viewFromMin || startMin > viewToMin) continue;
          const occupancy = Number(series[i] ?? 0);
          const capacity = normalizeCapacity(capacitySeries?.[i]);
          if (capacity == null) continue;
          if (!Number.isFinite(occupancy)) continue;
          const color = resolveHotspotColor({
            traffic_volume_id: tvId,
            hourly_occupancy: occupancy,
            hourly_capacity: capacity,
          }, hotspotSettings);
          if (!color) continue;
          const endMin = Math.min(startMin + binMinutes, Math.max(viewFromMin + 1, viewToMin));
          const startLabel = minutesToHHMM(startMin);
          const endLabel = minutesToHHMM(endMin);
          segments.push({
            period: `${startLabel}-${endLabel}`,
            color,
            metadata: [
              `Occupancy: ${occupancy.toFixed(0)}`,
              `Capacity: ${capacity.toFixed(0)}`,
              `Excess: ${(occupancy - capacity).toFixed(0)}`,
            ],
            label: `${tvId} overload`,
          });
        }
        if (segments.length > 0) {
          segmentsForSnapshot[tvId] = segments;
        }
      });
      map.set(snap.id, segmentsForSnapshot);
    });
    return map;
  }, [alignedSnapshots, capacityBySnapshot, hotspotSettings, minutesPerBin, tvSeriesBySnapshot, viewFromMin, viewToMin]);

  const tvIdsUnion = useMemo(() => {
    const set = new Set<string>();
    alignedSnapshots.forEach((snap) => {
      const map = tvSeriesBySnapshot.get(snap.id) || {};
      Object.keys(map).forEach((tv) => set.add(tv));
    });
    return Array.from(set);
  }, [alignedSnapshots, tvSeriesBySnapshot]);

  const tvFilterOptions = useMemo<ChipOption[]>(() => {
    return tvIdsUnion
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .map((id) => ({ id, label: id } as ChipOption));
  }, [tvIdsUnion]);

  useEffect(() => {
    const valid = new Set(tvFilterOptions.map((opt) => opt.id));
    setSelectedTvFilters((prev) => {
      const next = prev.filter((id) => valid.has(id));
      if (next.length === prev.length) return prev;
      return next;
    });
  }, [tvFilterOptions]);

  const selectedTvSet = useMemo(() => new Set(selectedTvFilters.map(String)), [selectedTvFilters]);
  const hasTvFilter = selectedTvFilters.length > 0;
  const selectedReliefSnapshot = useMemo(
    () => alignedSnapshots.find((snap) => snap.id === reliefSnapshotId) ?? alignedSnapshots[0] ?? null,
    [alignedSnapshots, reliefSnapshotId],
  );

  const reliefDeltasByTv = useMemo(() => {
    if (tvScope !== "aggregate") return {};
    if (!selectedReliefSnapshot) return {};
    const occupancy = selectedReliefSnapshot.aggregatedOccupancy;
    if (!occupancy?.pre_counts || !occupancy?.post_counts) return {};
    const binMinutes = Number(
      occupancy.time_bin_minutes || minutesPerBin || selectedReliefSnapshot.minutesPerBin || 15,
    );
    return computeNetDeltaByTv({
      preCounts: occupancy.pre_counts,
      postCounts: occupancy.post_counts,
      binMinutes,
      viewFrom,
      viewTo,
      tvIds: hasTvFilter ? Array.from(selectedTvSet) : undefined,
    });
  }, [
    tvScope,
    selectedReliefSnapshot,
    minutesPerBin,
    viewFrom,
    viewTo,
    hasTvFilter,
    selectedTvSet,
  ]);

  const reliefMapEmptyMessage = useMemo(() => {
    if (tvScope !== "aggregate") {
      return "Relief map is available only for Aggregate occupancy scope.";
    }
    if (!selectedReliefSnapshot) {
      return "Select at least one snapshot to display the relief map.";
    }
    const occupancy = selectedReliefSnapshot.aggregatedOccupancy;
    const preCount = Object.keys(occupancy?.pre_counts || {}).length;
    const postCount = Object.keys(occupancy?.post_counts || {}).length;
    if (preCount === 0 || postCount === 0) {
      return "Selected snapshot is missing baseline or post aggregate counts.";
    }
    if (hasTvFilter) {
      return "No pre/post occupancy deltas for the current traffic-volume filter and time window.";
    }
    return "No pre/post occupancy deltas in the selected time window.";
  }, [tvScope, selectedReliefSnapshot, hasTvFilter]);

  const tvMetrics: TvMetrics[] = useMemo(() => {
    return tvIdsUnion.map((tvId) => {
      let maxExceedance = 0;
      let maxPeak = 0;
      alignedSnapshots.forEach((snap) => {
        const series = tvSeriesBySnapshot.get(snap.id)?.[tvId] || [];
        const capacity = capacityBySnapshot.get(snap.id)?.[tvId] || [];
        for (let i = 0; i < series.length; i++) {
          const start = i * minutesPerBin;
          if (start < viewFromMin || start > viewToMin) continue;
          const val = Number(series[i] ?? 0) || 0;
          const cap = Number(capacity?.[i] ?? Number.POSITIVE_INFINITY);
          const exceed = Math.max(0, val - (Number.isFinite(cap) ? cap : 0));
          if (exceed > maxExceedance) maxExceedance = exceed;
          if (val > maxPeak) maxPeak = val;
        }
      });
      return { tvId, maxExceedance, maxPeak };
    });
  }, [alignedSnapshots, tvIdsUnion, tvSeriesBySnapshot, capacityBySnapshot, minutesPerBin, viewFromMin, viewToMin]);

  const aggregateSortScoresBySnapshot = useMemo(() => {
    const map = new Map<string, SnapshotTvSortScores>();
    if (tvScope !== "aggregate") return map;

    alignedSnapshots.forEach((snap) => {
      const emptyScores: SnapshotTvSortScores = {
        absChange: {},
        relativeChange: {},
        excessReduced: {},
        excessInduced: {},
      };
      const occ = snap.aggregatedOccupancy;
      if (!occ) {
        map.set(snap.id, emptyScores);
        return;
      }

      const pre = occ.pre_counts || {};
      const post = occ.post_counts || {};
      const capacity = occ.capacity || {};
      const tvIds = Array.from(new Set<string>([
        ...Object.keys(pre || {}),
        ...Object.keys(post || {}),
        ...Object.keys(capacity || {}),
      ]));

      if (tvIds.length === 0) {
        map.set(snap.id, emptyScores);
        return;
      }

      const minutes = Number(occ.time_bin_minutes || minutesPerBin || snap.minutesPerBin || 15);
      const statsByTv = computeOccupancyWindowStatsByTv({
        preCounts: pre,
        postCounts: post,
        capacity,
        tvIds,
        windowRange: getOccupancyWindowRange(viewFromMin, viewToMin, minutes),
        binMinutes: minutes,
        capacityHideThreshold: OCCUPANCY_CAPACITY_HIDE_THRESHOLD,
      });

      tvIds.forEach((tvId) => {
        const stats = statsByTv[tvId];
        emptyScores.absChange[tvId] = scoreOccupancyTvWindowStats(stats, "abs_change");
        emptyScores.relativeChange[tvId] = scoreOccupancyTvWindowStats(stats, "relative_change");
        emptyScores.excessReduced[tvId] = scoreOccupancyTvWindowStats(stats, "total_excess_reduced");
        emptyScores.excessInduced[tvId] = scoreOccupancyTvWindowStats(stats, "total_excess_induced");
      });

      map.set(snap.id, emptyScores);
    });

    return map;
  }, [alignedSnapshots, minutesPerBin, tvScope, viewFromMin, viewToMin]);

  const absChangeSortOptions = useMemo<ChangeSortOption[]>(() => {
    if (tvScope !== "aggregate") return [];
    return alignedSnapshots.map((snap) => {
      const occ = snap.aggregatedOccupancy;
      const preCount = Object.keys(occ?.pre_counts || {}).length;
      const postCount = Object.keys(occ?.post_counts || {}).length;
      let disabled = false;
      let reason: string | undefined;
      if (!occ || (preCount === 0 && postCount === 0)) {
        disabled = true;
        reason = "Snapshot is missing aggregate occupancy data.";
      } else if (preCount === 0) {
        disabled = true;
        reason = "Snapshot is missing baseline aggregate counts.";
      } else if (postCount === 0) {
        disabled = true;
        reason = "Snapshot is missing post-optimization aggregate counts.";
      }
      return {
        value: `${ABS_CHANGE_PREFIX}${snap.id}` as TvSortMode,
        label: `Rank by Absolute Change (${snap.description || "Untitled"})`,
        disabled,
        reason,
        snapshotId: snap.id,
      };
    });
  }, [alignedSnapshots, tvScope]);

  const relativeChangeSortOptions = useMemo<ChangeSortOption[]>(() => {
    if (tvScope !== "aggregate") return [];
    return alignedSnapshots.map((snap) => {
      const occ = snap.aggregatedOccupancy;
      const preCount = Object.keys(occ?.pre_counts || {}).length;
      const postCount = Object.keys(occ?.post_counts || {}).length;
      let disabled = false;
      let reason: string | undefined;
      if (!occ || postCount === 0) {
        disabled = true;
        reason = "Snapshot is missing post-optimization aggregate counts.";
      } else if (preCount === 0) {
        disabled = true;
        reason = "Snapshot is missing baseline aggregate counts.";
      }
      return {
        value: `${REL_CHANGE_PREFIX}${snap.id}` as TvSortMode,
        label: `Rank by Relative Change (${snap.description || "Untitled"})`,
        disabled,
        reason,
        snapshotId: snap.id,
      };
    });
  }, [alignedSnapshots, tvScope]);

  const excessReducedSortOptions = useMemo<ChangeSortOption[]>(() => {
    if (tvScope !== "aggregate") return [];
    return alignedSnapshots.map((snap) => {
      const occ = snap.aggregatedOccupancy;
      const preCount = Object.keys(occ?.pre_counts || {}).length;
      const postCount = Object.keys(occ?.post_counts || {}).length;
      const capacityCount = Object.keys(occ?.capacity || {}).length;
      let disabled = false;
      let reason: string | undefined;
      if (!occ || (preCount === 0 && postCount === 0 && capacityCount === 0)) {
        disabled = true;
        reason = "Snapshot is missing aggregate occupancy data.";
      } else if (preCount === 0) {
        disabled = true;
        reason = "Snapshot is missing baseline aggregate counts.";
      } else if (postCount === 0) {
        disabled = true;
        reason = "Snapshot is missing post-optimization aggregate counts.";
      } else if (capacityCount === 0) {
        disabled = true;
        reason = "Snapshot is missing aggregate capacity data.";
      }
      return {
        value: `${EXCESS_REDUCED_PREFIX}${snap.id}` as TvSortMode,
        label: `Total Excess Reduced (${snap.description || "Untitled"})`,
        disabled,
        reason,
        snapshotId: snap.id,
      };
    });
  }, [alignedSnapshots, tvScope]);

  const excessInducedSortOptions = useMemo<ChangeSortOption[]>(() => {
    if (tvScope !== "aggregate") return [];
    return alignedSnapshots.map((snap) => {
      const occ = snap.aggregatedOccupancy;
      const preCount = Object.keys(occ?.pre_counts || {}).length;
      const postCount = Object.keys(occ?.post_counts || {}).length;
      const capacityCount = Object.keys(occ?.capacity || {}).length;
      let disabled = false;
      let reason: string | undefined;
      if (!occ || (preCount === 0 && postCount === 0 && capacityCount === 0)) {
        disabled = true;
        reason = "Snapshot is missing aggregate occupancy data.";
      } else if (preCount === 0) {
        disabled = true;
        reason = "Snapshot is missing baseline aggregate counts.";
      } else if (postCount === 0) {
        disabled = true;
        reason = "Snapshot is missing post-optimization aggregate counts.";
      } else if (capacityCount === 0) {
        disabled = true;
        reason = "Snapshot is missing aggregate capacity data.";
      }
      return {
        value: `${EXCESS_INDUCED_PREFIX}${snap.id}` as TvSortMode,
        label: `Total Excess Induced (${snap.description || "Untitled"})`,
        disabled,
        reason,
        snapshotId: snap.id,
      };
    });
  }, [alignedSnapshots, tvScope]);

  const snapshotSortOptionMap = useMemo(() => {
    const options = [
      ...absChangeSortOptions,
      ...relativeChangeSortOptions,
      ...excessReducedSortOptions,
      ...excessInducedSortOptions,
    ];
    return new Map(options.map((option) => [option.value, option]));
  }, [
    absChangeSortOptions,
    relativeChangeSortOptions,
    excessReducedSortOptions,
    excessInducedSortOptions,
  ]);

  useEffect(() => {
    if (!isSnapshotScopedTvSortMode(tvSort)) return;
    if (tvScope !== "aggregate") {
      if (tvSort !== "exceedance") setTvSort("exceedance");
      return;
    }
    const option = snapshotSortOptionMap.get(tvSort);
    if (!option || option.disabled) {
      if (tvSort !== "exceedance") setTvSort("exceedance");
    }
  }, [snapshotSortOptionMap, tvScope, tvSort]);

  const filteredTvIds = useMemo(() => {
    let list = tvMetrics;
    if (hasTvFilter) {
      list = list.filter((item) => selectedTvSet.has(item.tvId));
    }
    const absChangeSnapshotId = getAbsChangeSnapshotId(tvSort);
    const absScores = absChangeSnapshotId
      ? aggregateSortScoresBySnapshot.get(absChangeSnapshotId)?.absChange || null
      : null;
    const relChangeSnapshotId = getRelativeChangeSnapshotId(tvSort);
    const relScores = relChangeSnapshotId
      ? aggregateSortScoresBySnapshot.get(relChangeSnapshotId)?.relativeChange || null
      : null;
    const excessReducedSnapshotId = getExcessReducedSnapshotId(tvSort);
    const excessReducedScores = excessReducedSnapshotId
      ? aggregateSortScoresBySnapshot.get(excessReducedSnapshotId)?.excessReduced || null
      : null;
    const excessInducedSnapshotId = getExcessInducedSnapshotId(tvSort);
    const excessInducedScores = excessInducedSnapshotId
      ? aggregateSortScoresBySnapshot.get(excessInducedSnapshotId)?.excessInduced || null
      : null;
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (absScores) {
        const scoreA = absScores[a.tvId] ?? 0;
        const scoreB = absScores[b.tvId] ?? 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        return collator.compare(a.tvId, b.tvId);
      }
      if (relScores) {
        const scoreA = relScores[a.tvId] ?? 0;
        const scoreB = relScores[b.tvId] ?? 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        const absMap = relChangeSnapshotId
          ? aggregateSortScoresBySnapshot.get(relChangeSnapshotId)?.absChange || {}
          : {};
        const absA = absMap[a.tvId] ?? 0;
        const absB = absMap[b.tvId] ?? 0;
        if (absB !== absA) return absB - absA;
        return collator.compare(a.tvId, b.tvId);
      }
      if (excessReducedScores) {
        const scoreA = excessReducedScores[a.tvId] ?? 0;
        const scoreB = excessReducedScores[b.tvId] ?? 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        const absMap = excessReducedSnapshotId
          ? aggregateSortScoresBySnapshot.get(excessReducedSnapshotId)?.absChange || {}
          : {};
        const absA = absMap[a.tvId] ?? 0;
        const absB = absMap[b.tvId] ?? 0;
        if (absB !== absA) return absB - absA;
        return collator.compare(a.tvId, b.tvId);
      }
      if (excessInducedScores) {
        const scoreA = excessInducedScores[a.tvId] ?? 0;
        const scoreB = excessInducedScores[b.tvId] ?? 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        const absMap = excessInducedSnapshotId
          ? aggregateSortScoresBySnapshot.get(excessInducedSnapshotId)?.absChange || {}
          : {};
        const absA = absMap[a.tvId] ?? 0;
        const absB = absMap[b.tvId] ?? 0;
        if (absB !== absA) return absB - absA;
        return collator.compare(a.tvId, b.tvId);
      }
      if (tvSort === "alphabetical") {
        return collator.compare(a.tvId, b.tvId);
      }
      if (tvSort === "peak") {
        if (b.maxPeak !== a.maxPeak) return b.maxPeak - a.maxPeak;
        return b.maxExceedance - a.maxExceedance;
      }
      if (b.maxExceedance !== a.maxExceedance) return b.maxExceedance - a.maxExceedance;
      return b.maxPeak - a.maxPeak;
    });
    return sorted.map((item) => item.tvId);
  }, [
    tvMetrics,
    hasTvFilter,
    selectedTvSet,
    tvSort,
    aggregateSortScoresBySnapshot,
  ]);

  const visibleTvs = filteredTvIds.slice(0, visibleTvCount);
  const remainingTvCount = Math.max(0, filteredTvIds.length - visibleTvCount);

  if (!hydrated || !ready || !user) {
    return null;
  }

  return (
    <main key={resourceDate ?? "no-resource-date"} className="min-h-screen w-screen overflow-x-hidden analytics-surface relative">
      <Header />
      <div className="pt-16 pb-12 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6">
            <div className="text-[11px] uppercase tracking-wider text-white/70">Analytics</div>
            <h1 className="text-2xl font-semibold text-white">Solution Comparison</h1>
            <div className="text-[12px] text-white/60 mt-1">Compare up to {MAX_SNAPSHOTS} saved optimization runs side-by-side.</div>
          </div>

          <section className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6 space-y-4">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div className="flex items-center gap-3 text-[12px] text-white/70">
                <span>{snapshots.length} snapshot(s) stored</span>
                <span className={snapshotSizeWarn ? "text-amber-200" : "text-white/70"}>~{snapshotSizeDisplayKb} KB in storage</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <button
                  onClick={() => {
                    setExportText(exportSnapshots());
                    setExportOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/20 bg-white/10 text-white/80 hover:bg-white/15"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                  Export
                </button>
                <button
                  onClick={() => { setImportText(""); setImportError(null); setImportOpen(true); }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/20 bg-white/10 text-white/80 hover:bg-white/15"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                  Import
                </button>
                <button
                  onClick={() => { clearSnapshots(); setSnapshots([]); setSelectedIds([]); }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/20 bg-red-500/20 text-red-100 hover:bg-red-500/30"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                  Clear all
                </button>
                <a
                  href="/flow-evaluation"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-emerald-400/60 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/25"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                  Collect new snapshot
                </a>
              </div>
            </div>

            {selectedSnapshots.length === 0 && (
              <div className="text-sm text-white/70 bg-white/5 border border-white/10 rounded-lg p-4">
                Select at least one snapshot to begin.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {snapshots.length === 0 && (
                <div className="col-span-full text-white/60 text-sm bg-white/5 border border-white/10 rounded-lg p-4">
                  No saved solutions yet. Head back to Flow Evaluation and click “Add to Comparison” after running an optimization.
                </div>
              )}
              {snapshots.map((snap, idx) => {
                const selected = selectedIds.includes(snap.id);
                const color = colorBySnapshotId.get(snap.id) || PALETTE[idx % PALETTE.length];
                const mismatched = minutesBySnapshot.mismatched.includes(snap.id);
                return (
                  <div key={snap.id} className={`rounded-lg border p-3 bg-white/5 space-y-3 ${selected ? 'border-emerald-300/70' : 'border-white/10'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(e) => {
                              const checked = e.currentTarget.checked;
                              setSelectedIds((prev) => {
                                if (checked) {
                                  if (prev.includes(snap.id)) return prev;
                                  if (prev.length >= MAX_SNAPSHOTS) return prev;
                                  return [...prev, snap.id];
                                }
                                return prev.filter((id) => id !== snap.id);
                              });
                            }}
                          />
                          <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                          <span className={`text-[10px] uppercase tracking-wider ${mismatched ? 'text-amber-300' : 'text-white/50'}`}>
                            {snap.minutesPerBin} min bins
                          </span>
                        </div>
                        <input
                          value={snap.description || "Untitled"}
                          onChange={(e) => {
                            const val = e.currentTarget.value;
                            setSnapshots((prev) => prev.map((s) => s.id === snap.id ? { ...s, description: val } : s));
                          }}
                          onBlur={(e) => {
                            const val = e.currentTarget.value.trim() || "Untitled";
                            if (val === snap.description) return;
                            try {
                              const next = updateSnapshotDescription(snap.id, val);
                              setSnapshots(next);
                            } catch (err) {
                              console.warn("Failed to rename snapshot", err);
                            }
                          }}
                          className="w-full px-2 py-1 rounded-md bg-white/10 border border-white/15 text-sm text-white focus:border-white/40"
                        />
                        <div className="text-[12px] text-white/60">
                          Saved {new Date(snap.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 items-end">
                        <button
                          onClick={() => {
                            try {
                              const next = deleteSnapshot(snap.id);
                              setSnapshots(next);
                            } catch (err) {
                              console.warn("Failed to delete snapshot", err);
                            }
                          }}
                          className="text-[11px] text-red-200 hover:text-red-100"
                        >Delete</button>
                        <div className="flex flex-col gap-1 text-[11px] text-white/70">
                          <button
                            onClick={() => {
                              const idxCurrent = snapshots.findIndex((s) => s.id === snap.id);
                              if (idxCurrent <= 0) return;
                              const ids = [...snapshots.map((s) => s.id)];
                              const [removed] = ids.splice(idxCurrent, 1);
                              ids.splice(idxCurrent - 1, 0, removed);
                              const reordered = reorderSnapshots(ids);
                              setSnapshots(reordered);
                            }}
                            className="hover:text-white"
                          >Move ↑</button>
                          <button
                            onClick={() => {
                              const idxCurrent = snapshots.findIndex((s) => s.id === snap.id);
                              if (idxCurrent < 0 || idxCurrent >= snapshots.length - 1) return;
                              const ids = [...snapshots.map((s) => s.id)];
                              const [removed] = ids.splice(idxCurrent, 1);
                              ids.splice(idxCurrent + 1, 0, removed);
                              const reordered = reorderSnapshots(ids);
                              setSnapshots(reordered);
                            }}
                            className="hover:text-white"
                          >Move ↓</button>
                        </div>
                      </div>
                    </div>
                    {mismatched && (
                      <div className="text-[11px] text-amber-200 bg-amber-500/10 border border-amber-400/40 rounded-md p-2">
                        Bin size {snap.minutesPerBin} differs from dominant {minutesBySnapshot.dominant} min. Charts use matching snapshots only.
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 text-[12px] text-white/70">
                      <div>
                        <div className="text-white/50 uppercase text-[10px] tracking-wider">Optimized</div>
                        <div className="font-mono text-white/90">{formatNumber(snap.objective.optimized?.score ?? null)}</div>
                      </div>
                      <div>
                        <div className="text-white/50 uppercase text-[10px] tracking-wider">Baseline</div>
                        <div className="font-mono text-white/90">{formatNumber(snap.objective.baseline?.score ?? null)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          

          <section className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-semibold text-white">Objective comparison</h2>
              {alignedSnapshots.length !== selectedSnapshots.length && (
                <div className="text-[12px] text-amber-200">Ignoring {selectedSnapshots.length - alignedSnapshots.length} snapshot(s) with mismatched bin sizes.</div>
              )}
            </div>

            <div className="flex flex-col lg:flex-row gap-6">
              {/* Left side: Objective scores and component table */}
              <div className="flex-1 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {alignedSnapshots.map((snap) => {
                    const color = colorBySnapshotId.get(snap.id) || "#fff";
                    const baseline = snap.objective.baseline?.score ?? null;
                    const optimized = snap.objective.optimized?.score ?? null;
                    const { absolute: improvementAbs, percent: improvementPct } = resolveObjectiveImprovement(snap);
                    const isBest =
                      improvementAbs != null &&
                      bestImprovementAbsolute != null &&
                      Math.abs(improvementAbs - bestImprovementAbsolute) < IMPROVEMENT_EPSILON;
                    const improvementClass = (() => {
                      if (improvementAbs == null) return "text-white/60";
                      if (improvementAbs > 0) return "text-emerald-300";
                      if (improvementAbs < 0) return "text-rose-300";
                      return "text-white/70";
                    })();
                    return (
                      <div key={snap.id} className="rounded-lg border border-white/10 bg-white/5 p-4 text-white/80 space-y-2">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <span className="inline-flex w-2 h-2 rounded-full" style={{ background: color }} />
                          <span>{snap.description || "Untitled"}</span>
                          {isBest && <span className="text-[10px] uppercase tracking-wider bg-emerald-500/20 border border-emerald-400/60 px-1.5 py-0.5 rounded text-emerald-100">Best</span>}
                        </div>
                        <div className="text-[12px] text-white/60">Optimized score</div>
                        <div className="text-2xl font-semibold text-white">{formatNumber(optimized, 2)}</div>
                        <div className="text-[12px] text-white/70">Baseline {formatNumber(baseline, 2)}</div>
                        <div className={`text-sm ${improvementClass}`}>
                          Improvement {formatNumber(improvementAbs, 2)} ({formatNumber(improvementPct, 1)}%)
                        </div>
                      </div>
                    );
                  })}
                </div>

                {objectiveComponentKeys.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm text-white/80">
                      <thead className="text-white/60 text-[12px] uppercase tracking-wider">
                        <tr>
                          <th className="text-left px-3 py-2">Objective component</th>
                          {alignedSnapshots.map((snap) => (
                            <th key={snap.id} className="text-left px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="inline-flex w-2 h-2 rounded-full" style={{ background: colorBySnapshotId.get(snap.id) || '#fff' }} />
                                <span>{snap.description || 'Untitled'}</span>
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {objectiveComponentKeys.map((key) => {
                          let bestValue: number | null = null;
                          alignedSnapshots.forEach((snap) => {
                            const candidate = getObjectiveComponentValue(snap.objective.optimized?.components, key);
                            if (candidate === null) return;
                            if (bestValue === null || candidate < bestValue) {
                              bestValue = candidate;
                            }
                          });

                          return (
                            <tr key={key} className="border-t border-white/10">
                              <td className="px-3 py-2 text-white/70">{key.replace(/_/g, ' ')}</td>
                              {alignedSnapshots.map((snap) => {
                                const baselineVal = getObjectiveComponentValue(snap.objective.baseline?.components, key);
                                const optimizedVal = getObjectiveComponentValue(snap.objective.optimized?.components, key);
                                const delta =
                                  baselineVal !== null && optimizedVal !== null
                                    ? optimizedVal - baselineVal
                                    : null;
                                const isBest =
                                  optimizedVal !== null &&
                                  bestValue !== null &&
                                  Math.abs(optimizedVal - bestValue) < IMPROVEMENT_EPSILON;
                                return (
                                  <td
                                    key={snap.id}
                                    className={`px-3 py-2 font-mono text-[13px] ${isBest ? 'text-emerald-200' : 'text-white/80'}`}
                                  >
                                    <div>{formatNumber(optimizedVal, 2)}</div>
                                    <div className="text-white/50 text-[11px]">→ {formatNumber(baselineVal, 2)} (Δ {formatNumber(delta, 2)})</div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Right side: Spider/Radar chart */}
              {objectiveRadarData.length > 0 && (
                <div className="w-full lg:w-96 xl:w-[420px] flex-shrink-0">
                  <div className="bg-white/5 border border-white/10 rounded-lg p-4 h-full">
                    <div className="text-sm font-medium text-white/80 mb-3">Objective Components Comparison</div>
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={objectiveRadarData} outerRadius="80%">
                          <PolarGrid stroke="rgba(148, 163, 184, 0.35)" />
                          <PolarAngleAxis
                            dataKey="metric"
                            tick={{ fill: "rgba(226, 232, 240, 0.8)", fontSize: 11 }}
                          />
                          <PolarRadiusAxis
                            angle={30}
                            domain={[0, objectiveRadarDomainMax]}
                            tick={{ fill: "rgba(226, 232, 240, 0.6)", fontSize: 10 }}
                            tickFormatter={(value: number) => `${formatNumber(value, 0)}%`}
                          />
                          <Tooltip
                            formatter={(value: unknown, _name, props) => {
                              if (typeof value !== "number" || !props) return String(value);
                              const dataKey = typeof props.dataKey === "string" ? props.dataKey : null;
                              const metricKey =
                                typeof (props.payload as { metricKey?: unknown })?.metricKey === "string"
                                  ? ((props.payload as { metricKey?: string }).metricKey as string)
                                  : null;
                              const rawValue =
                                dataKey && metricKey
                                  ? objectiveRadarRawValues.get(metricKey)?.get(dataKey)
                                  : null;
                              const percentLabel = `${formatNumber(value, 1)}%`;
                              if (rawValue == null) {
                                return percentLabel;
                              }
                              return `${percentLabel} (raw: ${formatNumber(rawValue, 2)})`;
                            }}
                            wrapperClassName="text-sm"
                            contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "white" }}
                            itemStyle={{ color: "white" }}
                            labelStyle={{ color: "white" }}
                          />
                          {alignedSnapshots.map((snap) => {
                            const color = colorBySnapshotId.get(snap.id) || "#fff";
                            return (
                              <Radar
                                key={snap.id}
                                name={snap.description || "Untitled"}
                                dataKey={snap.id}
                                stroke={color}
                                fill={color}
                                fillOpacity={0.2}
                              />
                            );
                          })}
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-3 space-y-1 text-[12px] text-white/70">
                      {alignedSnapshots.map((snap) => {
                        const color = colorBySnapshotId.get(snap.id) || "#fff";
                        return (
                          <div key={snap.id} className="flex items-center gap-2">
                            <span className="inline-flex w-2 h-2 rounded-full" style={{ background: color }} />
                            <span className="truncate">{snap.description || "Untitled"}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Delay comparison</h2>
              <div className="flex flex-wrap items-center gap-3 text-[12px] text-white/70">
                <div className="inline-flex rounded-md shadow-sm overflow-hidden">
                  <button
                    type="button"
                    aria-pressed={seriesView === 'flights'}
                    onClick={() => setSeriesView('flights')}
                    className={`h-[36px] px-3 text-[12px] font-medium border transition-colors flex items-center justify-center whitespace-nowrap ${
                      seriesView === 'flights'
                        ? 'bg-blue-500/20 border-blue-400/60 text-white'
                        : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15'
                    } rounded-l-md`}
                  >
                    By Flight
                  </button>
                  <button
                    type="button"
                    aria-pressed={seriesView === 'airports'}
                    onClick={() => setSeriesView('airports')}
                    className={`h-[36px] px-3 text-[12px] font-medium border transition-colors -ml-px flex items-center justify-center whitespace-nowrap ${
                      seriesView === 'airports'
                        ? 'bg-blue-500/20 border-blue-400/60 text-white'
                        : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15'
                    }`}
                  >
                    By Airport
                  </button>
                  <button
                    type="button"
                    aria-pressed={seriesView === 'acc'}
                    onClick={() => setSeriesView('acc')}
                    className={`h-[36px] px-3 text-[12px] font-medium border transition-colors -ml-px flex items-center justify-center whitespace-nowrap ${
                      seriesView === 'acc'
                        ? 'bg-blue-500/20 border-blue-400/60 text-white'
                        : 'bg-white/10 border-white/20 text-white/80 hover:bg-white/15'
                    } rounded-r-md`}
                  >
                    By ACC
                  </button>
                </div>
                {seriesView === 'flights' && (
                  <>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={flightDelayedOnly} onChange={(e) => setFlightDelayedOnly(e.currentTarget.checked)} />
                      Only delayed flights
                    </label>
                    <label className="inline-flex items-center gap-2">
                      Threshold ≥
                      <input
                        type="number"
                        value={flightThreshold}
                        onChange={(e) => setFlightThreshold(Math.max(0, Number(e.currentTarget.value) || 0))}
                        className="w-16 px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white"
                      />
                      min
                    </label>
                    <select
                      value={flightSort}
                      onChange={(e) => setFlightSort(e.currentTarget.value as FlightSortMode)}
                      className="px-2 py-1 rounded-md bg-white/10 border border-white/20 text-white"
                    >
                      <option value="max">Sort by max delay</option>
                      <option value="diff">Sort by diff</option>
                      <option value="callsign">Sort by callsign</option>
                    </select>
                    <FlightStatisticsButton
                      flightIds={flightRows.map((row) => row.flightId)}
                      buttonClassName="border-white/20 text-white/80"
                      ariaLabel="Open flight statistics for flight comparison"
                      title="Open flight statistics"
                    />
                  </>
                )}
              </div>
            </div>
            {seriesView === 'flights' ? (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm text-white/80">
                  <thead className="text-white/60 text-[12px] uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-3 py-2">Flight</th>
                      <th className="text-left px-3 py-2">Origin</th>
                      <th className="text-left px-3 py-2">Destination</th>
                      <th className="text-left px-3 py-2">Takeoff</th>
                      {alignedSnapshots.map((snap) => (
                        <th key={snap.id} className="text-right px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <span className="inline-flex w-2 h-2 rounded-full" style={{ background: colorBySnapshotId.get(snap.id) || '#fff' }} />
                            <span>{snap.description || 'Untitled'}</span>
                          </div>
                        </th>
                      ))}
                      <th className="text-right px-3 py-2">Max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flightRows.length === 0 && (
                      <tr>
                        <td colSpan={5 + alignedSnapshots.length} className="px-3 py-6 text-center text-white/50">
                          No flights meet the current filters.
                        </td>
                      </tr>
                    )}
                    {flightRows.map((row) => {
                      const maxValueRaw = Math.max(...row.delays.map((d) => Number(d.value ?? 0)));
                      const highlightValue = maxValueRaw > 0 ? maxValueRaw : null;
                      return (
                        <tr key={row.flightId} className="border-t border-white/10">
                          <td className="px-3 py-2 font-mono text-[13px] text-white/90">{row.callsign}</td>
                          <td className="px-3 py-2">{row.origin || '—'}</td>
                          <td className="px-3 py-2">{row.destination || '—'}</td>
                          <td className="px-3 py-2 font-mono text-[13px]">{row.takeoff || '—'}</td>
                          {row.delays.map((delay) => (
                            <td
                              key={delay.snapshotId}
                              className={`px-3 py-2 text-right font-mono text-[13px] ${highlightValue != null && delay.value != null && delay.value === highlightValue ? 'bg-white/10 text-white' : 'text-white/80'}`}
                            >
                              {formatNumber(delay.value, 1)}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-right font-mono text-[13px] text-white/90">{formatNumber(row.maxDelay, 1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {flightRows.length > 0 && (
                    <tfoot className="border-t border-white/15 text-[12px] text-white/70">
                      <tr>
                        <td className="px-3 py-2" colSpan={4}>Total delay (minutes)</td>
                        {alignedSnapshots.map((snap) => {
                          const stat = flightColumnStats.find((s) => s.snapshotId === snap.id);
                          const isBest = stat && bestFlightTotal != null && stat.total === bestFlightTotal;
                          return (
                            <td key={snap.id} className={`px-3 py-2 text-right font-mono text-[12px] ${isBest ? 'text-emerald-200' : 'text-white/70'}`}>
                              {formatNumber(stat?.total ?? null, 1)}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right">—</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2" colSpan={4}>Average per flight</td>
                        {alignedSnapshots.map((snap) => {
                          const stat = flightColumnStats.find((s) => s.snapshotId === snap.id);
                          const isBest = stat && bestFlightAverage != null && stat.average === bestFlightAverage;
                          return (
                            <td key={`${snap.id}-avg`} className={`px-3 py-2 text-right font-mono text-[12px] ${isBest ? 'text-emerald-200' : 'text-white/70'}`}>
                              {formatNumber(stat?.average ?? null, 2)}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right">—</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            ) : seriesView === 'airports' ? (
              <div className="mt-4 space-y-6">
                {airportStatsBySnapshot.size === 0 ? (
                  <div className="bg-white/5 border border-white/10 rounded-lg p-4 text-sm text-white/70">
                    No delay assignments found in the selected snapshots.
                  </div>
                ) : (
                  <>
                    {snapshotsMissingDelayData.length > 0 && (
                      <div className="text-[12px] text-amber-200">
                        {snapshotsMissingDelayData.length === 1
                          ? `Snapshot ${snapshotsMissingDelayData[0].description || 'Untitled'} is missing delay assignments.`
                          : `Snapshots ${snapshotsMissingDelayData.map((snap) => snap.description || 'Untitled').join(', ')} are missing delay assignments.`}
                      </div>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {alignedSnapshots.map((snap) => {
                        const stats = airportStatsBySnapshot.get(snap.id);
                        const color = colorBySnapshotId.get(snap.id) || '#fff';
                        return (
                          <div key={snap.id} className="bg-white/5 border border-white/10 rounded-lg p-4 text-white/80 space-y-2">
                            <div className="flex items-center gap-2 text-sm font-semibold">
                              <span className="inline-flex w-2 h-2 rounded-full" style={{ background: color }} />
                              <span>{snap.description || 'Untitled'}</span>
                            </div>
                            {stats ? (
                              <>
                                <div className="text-[11px] uppercase tracking-wider text-white/60">Flights with delay</div>
                                <div className="text-2xl font-semibold text-white">{formatFlights(stats.totalFlights)}</div>
                                <div className="text-[12px] text-white/60">Total delay {formatAdaptive(stats.totalDelay, 1)} min • Avg {formatAverage(stats.averageDelay)} min</div>
                                <div className="text-[12px] text-white/60">Airports observed {stats.uniqueAirports}</div>
                                <div className="text-[12px] text-white/60">
                                  Heaviest delay:{' '}
                                  {stats.heaviest
                                    ? `${stats.heaviest.callSign} (${stats.heaviest.origin}→${stats.heaviest.destination}) ${formatAdaptive(stats.heaviest.delay, 1)} min`
                                    : '—'}
                                </div>
                              </>
                            ) : (
                              <div className="text-[12px] text-white/60">No delay assignments captured for this snapshot.</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {airportChartData.length > 0 && airportChartSeries.length > 0 && (
                      <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                          <div className="text-[11px] uppercase tracking-wider text-white/60">Airport delay comparison</div>
                          <div className="flex items-center gap-3 text-[11px] text-white/60">
                            <select
                              aria-label="Select airport comparison metric"
                              className="h-8 px-3 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15 transition-colors text-[12px]"
                              value={airportChartMetric}
                              onChange={(event) => setAirportChartMetric(event.currentTarget.value as 'delay' | 'flights')}
                            >
                              <option value="delay">Total delay (min)</option>
                              <option value="flights">Delayed flights</option>
                            </select>
                            <div>{airportChartSummaryText}</div>
                          </div>
                        </div>
                        <div className="h-72">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={airportChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                              <XAxis dataKey="airport" tick={{ fontSize: 11, fill: '#e2e8f0' }} axisLine={{ stroke: 'rgba(255,255,255,0.2)' }} tickLine={false} />
                              <YAxis
                                tick={{ fontSize: 11, fill: '#e2e8f0' }}
                                tickFormatter={(value: number) => formatAirportChartValue(value)}
                                axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                                tickLine={false}
                                allowDecimals={airportChartMetric === 'delay'}
                              />
                              <Tooltip
                                formatter={(value: number, name: string, entry) => {
                                  const key = (entry && 'dataKey' in entry ? entry.dataKey : undefined) as string | undefined;
                                  const label = (key && airportChartSeriesLookup.get(key)) || name;
                                  return [`${formatAirportChartValue(value)} ${airportChartTooltipUnit}`, label];
                                }}
                                labelFormatter={(label) => `Airport ${label}`}
                                contentStyle={{ background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: 'white' }}
                                itemStyle={{ color: 'white' }}
                                labelStyle={{ color: 'white' }}
                              />
                              <Legend wrapperStyle={{ color: '#f8fafc' }} />
                              {airportChartSeries.map((series) => (
                                <Bar key={series.key} dataKey={series.key} name={series.label} fill={series.color} />
                              ))}
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}
                    <div className="grid gap-6 lg:grid-cols-2">
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-white/60 mb-2">Departure airports</div>
                        <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                          <table className="w-full text-sm text-white/90">
                            <thead className="bg-white/5 text-white/70">
                              <tr>
                                <th className="text-left px-3 py-2">Airport</th>
                                {alignedSnapshots.map((snap) => (
                                  <th key={snap.id} className="text-left px-3 py-2">
                                    <div className="flex items-center gap-2">
                                      <span className="inline-flex w-2 h-2 rounded-full" style={{ background: colorBySnapshotId.get(snap.id) || '#fff' }} />
                                      <span>{snap.description || 'Untitled'}</span>
                                    </div>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {departureComparison.rows.length === 0 ? (
                                <tr>
                                  <td colSpan={1 + alignedSnapshots.length} className="px-3 py-4 text-center text-white/60">
                                    No airports observed in the selected snapshots.
                                  </td>
                                </tr>
                              ) : (
                                departureComparison.rows.map((row) => {
                                  const bestValue = Math.min(
                                    ...alignedSnapshots.map((snap) => row.perSnapshot[snap.id]?.totalDelay ?? Number.POSITIVE_INFINITY)
                                  );
                                  return (
                                    <tr key={`dep-${row.airport}`} className="border-t border-white/10 hover:bg-white/5">
                                      <td className="px-3 py-2 font-medium text-white">{row.airport}</td>
                                      {alignedSnapshots.map((snap) => {
                                        const cell = row.perSnapshot[snap.id];
                                        const isBest = cell && Number.isFinite(bestValue) && cell.totalDelay === bestValue;
                                        return (
                                          <td key={snap.id} className="px-3 py-2">
                                            {cell ? (
                                              <div className={`space-y-1 ${isBest ? 'text-emerald-200' : 'text-white/80'}`}>
                                                <div className="font-mono text-[13px]">
                                                  {airportChartMetric === 'flights'
                                                    ? `${formatFlights(cell.flightCount)} flights`
                                                    : `${formatAdaptive(cell.totalDelay, 1)} min`}
                                                </div>
                                                <div className="text-[11px] text-white/60">
                                                  {airportChartMetric === 'flights'
                                                    ? `Delay ${formatAdaptive(cell.totalDelay, 1)} min · Avg ${formatAverage(cell.averageDelay)} · Max ${formatAdaptive(cell.maxDelay, 1)} · Min ${formatAdaptive(cell.minDelay, 1)}`
                                                    : `Flights ${formatFlights(cell.flightCount)} · Avg ${formatAverage(cell.averageDelay)} · Max ${formatAdaptive(cell.maxDelay, 1)} · Min ${formatAdaptive(cell.minDelay, 1)}`}
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="text-[11px] text-white/50 italic">—</div>
                                            )}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                        {departureComparison.totalCount > departureComparison.rows.length && (
                          <div className="mt-2 text-[11px] text-white/60">
                            Showing top {departureComparison.rows.length} of {departureComparison.totalCount} airports.
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-white/60 mb-2">Arrival airports</div>
                        <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                          <table className="w-full text-sm text-white/90">
                            <thead className="bg-white/5 text-white/70">
                              <tr>
                                <th className="text-left px-3 py-2">Airport</th>
                                {alignedSnapshots.map((snap) => (
                                  <th key={snap.id} className="text-left px-3 py-2">
                                    <div className="flex items-center gap-2">
                                      <span className="inline-flex w-2 h-2 rounded-full" style={{ background: colorBySnapshotId.get(snap.id) || '#fff' }} />
                                      <span>{snap.description || 'Untitled'}</span>
                                    </div>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {arrivalComparison.rows.length === 0 ? (
                                <tr>
                                  <td colSpan={1 + alignedSnapshots.length} className="px-3 py-4 text-center text-white/60">
                                    No airports observed in the selected snapshots.
                                  </td>
                                </tr>
                              ) : (
                                arrivalComparison.rows.map((row) => {
                                  const bestValue = Math.min(
                                    ...alignedSnapshots.map((snap) => row.perSnapshot[snap.id]?.totalDelay ?? Number.POSITIVE_INFINITY)
                                  );
                                  return (
                                    <tr key={`arr-${row.airport}`} className="border-t border-white/10 hover:bg-white/5">
                                      <td className="px-3 py-2 font-medium text-white">{row.airport}</td>
                                      {alignedSnapshots.map((snap) => {
                                        const cell = row.perSnapshot[snap.id];
                                        const isBest = cell && Number.isFinite(bestValue) && cell.totalDelay === bestValue;
                                        return (
                                          <td key={snap.id} className="px-3 py-2">
                                            {cell ? (
                                              <div className={`space-y-1 ${isBest ? 'text-emerald-200' : 'text-white/80'}`}>
                                                <div className="font-mono text-[13px]">
                                                  {airportChartMetric === 'flights'
                                                    ? `${formatFlights(cell.flightCount)} flights`
                                                    : `${formatAdaptive(cell.totalDelay, 1)} min`}
                                                </div>
                                                <div className="text-[11px] text-white/60">
                                                  {airportChartMetric === 'flights'
                                                    ? `Delay ${formatAdaptive(cell.totalDelay, 1)} min · Avg ${formatAverage(cell.averageDelay)} · Max ${formatAdaptive(cell.maxDelay, 1)} · Min ${formatAdaptive(cell.minDelay, 1)}`
                                                    : `Flights ${formatFlights(cell.flightCount)} · Avg ${formatAverage(cell.averageDelay)} · Max ${formatAdaptive(cell.maxDelay, 1)} · Min ${formatAdaptive(cell.minDelay, 1)}`}
                                                </div>
                                              </div>
                                            ) : (
                                              <div className="text-[11px] text-white/50 italic">—</div>
                                            )}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                        {arrivalComparison.totalCount > arrivalComparison.rows.length && (
                          <div className="mt-2 text-[11px] text-white/60">
                            Showing top {arrivalComparison.rows.length} of {arrivalComparison.totalCount} airports.
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="mt-4">
                <PerAccDelayComparisonPanel
                  snapshots={selectedSnapshots}
                  colorBySnapshotId={colorBySnapshotId}
                  mode={accAttribMode}
                  onModeChange={setAccAttribMode}
                />
              </div>
            )}
          </section>

          <section className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-white/70 text-sm">Time window</div>
              <div className="text-[12px] text-white/60">Filtering charts and tables to {viewFrom} – {viewTo}</div>
            </div>
            <div className="mt-3">
              <TimeScaleControl
                time_from={viewFrom}
                time_to={viewTo}
                onCommit={(from, to) => { setViewFrom(from); setViewTo(to); }}
              />
            </div>
          </section>

          <section className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-semibold text-white">Traffic volume occupancy</h2>
              <div className="flex flex-wrap items-center gap-3 text-[12px] text-white/70 justify-end w-full sm:w-auto">
                <select
                  value={tvScope}
                  onChange={(e) => { setTvScope(e.currentTarget.value as OccupancyScope); setVisibleTvCount(6); }}
                  className="h-[42px] px-3 rounded-md bg-white/10 border border-white/20 text-white"
                >
                  <option value="aggregate">Aggregate occupancy</option>
                  <option value="targets">Target TVs (post-opt)</option>
                  <option value="ripples">Ripple TVs (post-opt)</option>
                </select>
                <select
                  value={tvSort}
                  onChange={(e) => setTvSort(e.currentTarget.value as TvSortMode)}
                  className="h-[42px] px-3 rounded-md bg-white/10 border border-white/20 text-white"
                >
                  <option value="exceedance">Sort by exceedance</option>
                  <option value="peak">Sort by peak</option>
                  <option value="alphabetical">Sort alphabetically</option>
                  {absChangeSortOptions.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled}
                      title={option.reason}
                    >
                      {option.label}
                    </option>
                  ))}
                  {relativeChangeSortOptions.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled}
                      title={option.reason}
                    >
                      {option.label}
                    </option>
                  ))}
                  {excessReducedSortOptions.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled}
                      title={option.reason}
                    >
                      {option.label}
                    </option>
                  ))}
                  {excessInducedSortOptions.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled}
                      title={option.reason}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="min-w-[220px] sm:min-w-[260px] w-full sm:w-[260px]">
                  <MultiSelectWithChips
                    options={tvFilterOptions}
                    selectedIds={selectedTvFilters}
                    onChange={(ids) => { setSelectedTvFilters(ids); setVisibleTvCount(6); }}
                    placeholder="Filter traffic volumes"
                  />
                </div>
              </div>
            </div>

            <div className="mb-4 rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="text-[11px] uppercase tracking-wider text-white/60">Traffic Volume Relief Map</div>
                {tvScope === "aggregate" && alignedSnapshots.length > 0 && (
                  <div className="flex items-center gap-2 text-[11px] text-white/60">
                    <span>Snapshot</span>
                    <select
                      value={selectedReliefSnapshot?.id || ""}
                      onChange={(e) => setReliefSnapshotId(e.currentTarget.value)}
                      className="h-8 px-2 rounded-md bg-white/10 border border-white/20 text-white/90"
                    >
                      {alignedSnapshots.map((snap) => (
                        <option key={`relief-${snap.id}`} value={snap.id}>
                          {snap.description || "Untitled"}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <TrafficVolumeReliefMap
                deltasByTv={reliefDeltasByTv}
                emptyMessage={reliefMapEmptyMessage}
              />
            </div>

            {visibleTvs.length === 0 && (
              <div className="text-sm text-white/60 bg-white/5 border border-white/10 rounded-lg p-4">
                No traffic volumes match the current scope or filters.
              </div>
            )}
            {visibleTvs.length === 0 && alignedSnapshots.length > 0 && tvIdsUnion.length === 0 && (
              <div className="text-sm text-amber-200 bg-amber-500/10 border border-amber-400/30 rounded-lg p-4 mt-3">
                The selected snapshots do not include occupancy data for the “{tvScope}” scope. Try switching scopes or refreshing the snapshot from Flow Evaluation.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleTvs.map((tvId) => {
                const chartData: Array<Record<string, any>> = [];
                let maxBins = alignedSnapshots.reduce((max, snap) => {
                  const series = tvSeriesBySnapshot.get(snap.id)?.[tvId] || [];
                  return Math.max(max, series.length);
                }, 0);
                const capacitySeries = capacityBySnapshot.get(alignedSnapshots[0]?.id || "")?.[tvId];
                if (capacitySeries && Array.isArray(capacitySeries)) {
                  maxBins = Math.max(maxBins, capacitySeries.length);
                }
                for (let i = 0; i < maxBins; i++) {
                  const start = i * minutesPerBin;
                  if (start < viewFromMin || start > viewToMin) continue;
                  const entry: Record<string, any> = { idx: i, label: binIndexToRangeLabel(i, minutesPerBin) };
                  let hasValue = false;
                  alignedSnapshots.forEach((snap) => {
                    const series = tvSeriesBySnapshot.get(snap.id)?.[tvId] || [];
                    const val = Number(series[i] ?? 0) || 0;
                    if (val !== 0) hasValue = true;
                    entry[snap.id] = val;
                  });
                  if (capacitySeries && Array.isArray(capacitySeries)) {
                    const cap = normalizeCapacity(capacitySeries[i]);
                    if (cap != null) {
                      entry.capacity = cap;
                      hasValue = true;
                    }
                  }
                  if (hasValue) chartData.push(entry);
                }

                const normalizationFactor = minutesPerBin > 0 ? minutesPerBin / 60 : 1;
                const legendMetrics = alignedSnapshots.map((snap) => {
                  const series = tvSeriesBySnapshot.get(snap.id)?.[tvId] || [];
                  const capacity = capacityBySnapshot.get(snap.id)?.[tvId] || [];
                  let peak = 0;
                  let exceedance = 0;
                  for (let i = 0; i < series.length; i++) {
                    const start = i * minutesPerBin;
                    if (start < viewFromMin || start > viewToMin) continue;
                    const val = Number(series[i] ?? 0) || 0;
                    if (val > peak) peak = val;
                    const cap = normalizeCapacity(capacity?.[i]);
                    if (cap != null) {
                      exceedance += Math.max(0, val - cap) * normalizationFactor;
                    }
                  }
                  return { snap, peak, exceedance };
                });

                const hasCapacity = Array.isArray(capacitySeries) && capacitySeries.some((cap) => normalizeCapacity(cap) != null);
                const hasSeries = alignedSnapshots.some((snap) => (tvSeriesBySnapshot.get(snap.id)?.[tvId] || []).length > 0);
                return (
                  <div key={tvId} className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-white truncate">
                        <TrafficVolumeInfoTooltip trafficVolumeId={tvId} className="truncate max-w-full">
                          <span className="truncate">{tvId}</span>
                        </TrafficVolumeInfoTooltip>
                      </div>
                    </div>
                    <div className="h-48">
                      {hasSeries || hasCapacity ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                            <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#cbd5f5" }} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10, fill: "#cbd5f5" }} width={40} allowDecimals={false} />
                            <Tooltip
                              wrapperStyle={{ zIndex: 20 }}
                              contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "white" }}
                              labelStyle={{ color: "white" }}
                              formatter={(value: any, name: any) => [String(value), name]}
                            />
                            {hasCapacity && <Line type="monotone" dataKey="capacity" name="Capacity" stroke="#f87171" strokeWidth={1.8} dot={false} />}
                            {alignedSnapshots.map((snap) => (
                              <Bar
                                key={snap.id}
                                dataKey={snap.id}
                                name={snap.description || 'Untitled'}
                                fill={colorBySnapshotId.get(snap.id) || '#fff'}
                                barSize={Math.max(6, 28 / Math.max(1, alignedSnapshots.length))}
                              />
                            ))}
                          </ComposedChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-sm text-white/50">
                          No occupancy data for this TV in the selected snapshots.
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      {alignedSnapshots.map((snap) => {
                        const segs = (overloadSegmentsBySnapshot.get(snap.id) || {})[tvId] || [];
                        return (
                          <div key={`overbar-${tvId}-${snap.id}`} className="flex items-center gap-2">
                            <div className="shrink-0 w-40 max-w-[40%] flex items-center gap-1 text-[12px] text-white/70 truncate">
                              <span className="inline-flex w-2 h-2 rounded-full" style={{ background: colorBySnapshotId.get(snap.id) || '#fff' }} />
                              <span className="truncate">{snap.description || 'Untitled'}</span>
                            </div>
                            <div className="grow min-w-0">
                              <TrafficOverloadBar
                                fromTime={viewFrom}
                                toTime={viewTo}
                                data={segs}
                                showTime={segs.length > 0}
                                showOkWhenNoData={false}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="space-y-1 text-[12px] text-white/70">
                      {legendMetrics.map(({ snap, peak, exceedance }) => (
                        <div key={snap.id} className="flex items-center gap-2">
                          <span className="inline-flex w-2 h-2 rounded-full" style={{ background: colorBySnapshotId.get(snap.id) || '#fff' }} />
                          <span className="text-white/80">{snap.description || 'Untitled'}</span>
                          <span className="text-white/60">Peak {formatNumber(peak, 1)}</span>
                          {tvScope === 'aggregate' && <span className="text-white/60">Exceedance {formatNumber(exceedance, 1)}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {visibleTvCount < filteredTvIds.length && (
              <div className="flex justify-center mt-4">
                <button
                  onClick={() => setVisibleTvCount((c) => Math.min(filteredTvIds.length, c + 6))}
                  className="px-3 py-1.5 rounded-md border border-white/20 bg-white/10 text-white/80 hover:bg-white/15 text-sm"
                >{formatSeeMoreLabel(remainingTvCount)}</button>
              </div>
            )}
          </section>
        </div>
      </div>

      <ModalDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export snapshots"
        description="Copy JSON to share or back up your saved solutions"
        width="w-[min(720px,95vw)]"
        height="h-auto max-h-[80vh]"
      >
        <div className="p-6 space-y-4 text-sm">
          <textarea
            value={exportText}
            onChange={(e) => setExportText(e.currentTarget.value)}
            className="w-full min-h-[320px] bg-black/40 border border-white/20 rounded-lg p-3 font-mono text-xs text-white"
          />
          <div className="flex justify-end gap-3">
            <button
              onClick={() => {
                try {
                  const data = exportText || "";
                  const blob = new Blob([data], { type: "application/json;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const now = new Date();
                  const pad = (n: number) => String(n).padStart(2, "0");
                  const filename = `snapshots_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = filename;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                } catch (e) {
                  console.warn("Failed to download export JSON", e);
                }
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-emerald-300 bg-emerald-500/30 text-emerald-50 hover:bg-emerald-500/40"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M9 3a1 1 0 0 1 2 0v8.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4A1 1 0 0 1 6.707 9.293L9 11.586V3z" />
                <path d="M4 15a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1z" />
              </svg>
              <span>Download JSON</span>
            </button>
            <button
              onClick={() => setExportOpen(false)}
              className="px-3 py-1.5 rounded-md border border-white/20 bg-white/10 text-white/80 hover:bg-white/15"
            >Close</button>
          </div>
        </div>
      </ModalDialog>

      <ModalDialog
        open={importOpen}
        onClose={() => { setImportOpen(false); setImportError(null); }}
        title="Import snapshots"
        description="Paste JSON exported from this tool; import replaces your current stored snapshots"
        width="w-[min(720px,95vw)]"
        height="h-auto max-h-[80vh]"
      >
        <div className="p-6 space-y-4 text-sm">
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.currentTarget.value)}
            className="w-full min-h-[280px] bg-black/40 border border-white/20 rounded-lg p-3 font-mono text-xs text-white"
          />
          {importError && <div className="text-[12px] text-red-300">{importError}</div>}
          <div className="flex justify-end gap-3">
            <button
              onClick={() => { setImportOpen(false); setImportError(null); setImportText(""); }}
              className="px-3 py-1.5 rounded-md border border-white/20 bg-white/10 text-white/80 hover:bg-white/15"
            >Cancel</button>
            <button
              onClick={() => {
                try {
                  const next = importSnapshots(importText);
                  setSnapshots(next);
                  setImportOpen(false);
                  setImportText("");
                  setImportError(null);
                } catch (err: any) {
                  setImportError(err?.message || "Failed to import snapshots");
                }
              }}
              className="px-4 py-1.5 rounded-md border border-emerald-300 bg-emerald-500/30 text-emerald-50 hover:bg-emerald-500/40"
            >Import</button>
          </div>
        </div>
      </ModalDialog>
    </main>
  );
}
