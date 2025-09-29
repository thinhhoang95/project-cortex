"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import TimeScaleControl from "@/components/TimeScaleControl";
import ModalDialog from "@/components/ModalDialog";
import MultiSelectWithChips, { ChipOption } from "@/components/MultiSelectWithChips";
import FlightStatisticsButton from "@/components/FlightStatisticsButton";
import TrafficVolumeInfoTooltip from "@/components/TrafficVolumeInfoTooltip";
import {
  RegulationSnapshot,
  loadRegSnapshots,
  updateRegSnapshotDescription,
  deleteRegSnapshot,
  reorderRegSnapshots,
  clearRegSnapshots,
  exportRegSnapshots,
  importRegSnapshots,
  MAX_REG_SNAPSHOTS,
  estimateRegSnapshotsSize,
  REG_SNAPSHOT_SIZE_WARN_THRESHOLD,
  REG_SNAPSHOT_STORAGE_KEY,
} from "@/lib/reg-comparison";
import { useSimStore } from "@/components/useSimStore";
import { loadTrajectories } from "@/lib/flights";
import { hhmmToMinutesSafe, minutesToHHMM, binIndexToRangeLabel } from "@/lib/time";
import { formatSeeMoreLabel } from "@/lib/seeMoreLess";
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

type FlightSortMode = "max" | "diff" | "callsign";
type TvSortMode =
  | "exceedance"
  | "peak"
  | "alphabetical"
  | `${typeof ABS_CHANGE_PREFIX}${string}`
  | `${typeof REL_CHANGE_PREFIX}${string}`;

function getPrefixedSnapshotId(
  mode: TvSortMode,
  prefix: typeof ABS_CHANGE_PREFIX | typeof REL_CHANGE_PREFIX,
): string | null {
  return mode.startsWith(prefix) ? mode.slice(prefix.length) : null;
}

const getAbsChangeSnapshotId = (mode: TvSortMode) => getPrefixedSnapshotId(mode, ABS_CHANGE_PREFIX);
const getRelativeChangeSnapshotId = (mode: TvSortMode) => getPrefixedSnapshotId(mode, REL_CHANGE_PREFIX);

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
  combinedEntries: AirportDelayChartRow[];
  chartTotalCount: number;
  uniqueAirports: number;
};

type AirportComparisonRow = {
  airport: string;
  combinedTotal: number;
  perSnapshot: Record<string, AirportDelayRow>;
};

function formatNumber(val: number | null | undefined, digits = 2) {
  if (val === null || val === undefined || Number.isNaN(val)) return "—";
  if (!Number.isFinite(val)) return "∞";
  return Number(val).toFixed(digits);
}

function toFiniteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

const OBJECTIVE_COMPONENT_KEYS = ["J_CAP", "J_DELAY"] as const;
type ObjectiveComponentKey = (typeof OBJECTIVE_COMPONENT_KEYS)[number];

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
  key: ObjectiveComponentKey,
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

function formatSecondsToHMM(totalSeconds: number | null | undefined): string {
  if (!Number.isFinite(totalSeconds ?? NaN)) return "—";
  const s = Math.max(0, Math.floor(totalSeconds as number));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
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

export default function RegulationComparisonPage() {
  const router = useRouter();
  const user = useSimStore((state) => state.user);
  const { flights, setFlights, setRange } = useSimStore();
  const [hydrated, setHydrated] = useState(false);

  const [snapshots, setSnapshots] = useState<RegulationSnapshot[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewFrom, setViewFrom] = useState("00:00");
  const [viewTo, setViewTo] = useState("23:59");
  const [seriesView, setSeriesView] = useState<"flights" | "airports">("flights");
  const [airportChartMetric, setAirportChartMetric] = useState<'delay' | 'flights'>('delay');
  const [tvSort, setTvSort] = useState<TvSortMode>("exceedance");
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
    const unsub = useSimStore.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useSimStore.persist.hasHydrated());
    return () => { unsub(); };
  }, []);

  useEffect(() => {
    if (hydrated && !user) {
      router.push("/login");
    }
  }, [hydrated, user, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const current = loadRegSnapshots();
    setSnapshots(current);
    setSelectedIds((prev) => {
      if (prev.length > 0) return prev.filter((id) => current.some((s) => s.id === id));
      return current.slice(0, Math.min(2, current.length)).map((s) => s.id);
    });
    const onStorage = (ev: StorageEvent) => {
      if (ev.key && ev.key !== REG_SNAPSHOT_STORAGE_KEY) return;
      const next = loadRegSnapshots();
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
        const tracks = await loadTrajectories("/data/flights_20230801.csv");
        if (cancelled) return;
        setFlights(tracks);
        if (tracks && tracks.length > 0) {
          const minT = Math.min(...tracks.map((tr: any) => tr.t0));
          const maxT = Math.max(...tracks.map((tr: any) => tr.t1));
          setRange([minT, maxT], minT);
        }
      } catch (e) {
        console.warn("Failed to load flight trajectories for regulation comparison page", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flights.length, setFlights, setRange]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const filtered = prev.filter((id) => snapshots.some((s) => s.id === id));
      if (filtered.length > 0) return filtered;
      return snapshots.slice(0, Math.min(2, snapshots.length)).map((s) => s.id);
    });
  }, [snapshots]);

  const snapshotSizeBytes = useMemo(() => estimateRegSnapshotsSize(snapshots), [snapshots]);
  const snapshotSizeWarn = snapshotSizeBytes > REG_SNAPSHOT_SIZE_WARN_THRESHOLD;
  const snapshotSizeDisplayKb = Math.max(0, Math.round(snapshotSizeBytes / 1024));

  const selectedSnapshots = useMemo(
    () => selectedIds.map((id) => snapshots.find((s) => s.id === id)).filter(Boolean) as RegulationSnapshot[],
    [selectedIds, snapshots],
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
      mismatched: selectedSnapshots
        .filter((snap) => dominant !== null && snap.minutesPerBin !== dominant)
        .map((snap) => snap.id),
    };
  }, [selectedSnapshots]);

  const alignedSnapshots = useMemo(() => {
    if (!minutesBySnapshot.dominant) return selectedSnapshots;
    return selectedSnapshots.filter((snap) => snap.minutesPerBin === minutesBySnapshot.dominant);
  }, [selectedSnapshots, minutesBySnapshot]);

  const minutesPerBin = minutesBySnapshot.dominant || (alignedSnapshots[0]?.minutesPerBin ?? 15);
  const viewFromMin = hhmmToMinutesSafe(viewFrom);
  const viewToMin = hhmmToMinutesSafe(viewTo);

  const { flightsById, flightsByCallsign } = useMemo(() => {
    const byId = new Map<string, any>();
    const byCallsign = new Map<string, any>();
    for (const fl of flights) {
      if (fl?.flightId) byId.set(String(fl.flightId), fl);
      if (fl?.callSign) byCallsign.set(String(fl.callSign), fl);
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

  const bestTotalDelaySeconds = useMemo(() => {
    if (selectedSnapshots.length === 0) return null;
    return Math.min(
      ...selectedSnapshots.map((snap) => snap.delayStats?.total_delay_seconds ?? Number.POSITIVE_INFINITY),
    );
  }, [selectedSnapshots]);

  const bestMeanDelaySeconds = useMemo(() => {
    if (selectedSnapshots.length === 0) return null;
    return Math.min(
      ...selectedSnapshots.map((snap) => snap.delayStats?.mean_delay_seconds ?? Number.POSITIVE_INFINITY),
    );
  }, [selectedSnapshots]);

  const bestObjectiveScore = useMemo(() => {
    const scores = selectedSnapshots
      .map((snap) => toFiniteNumber(snap.objective?.score))
      .filter((value): value is number => value !== null);
    if (scores.length === 0) return null;
    return Math.min(...scores);
  }, [selectedSnapshots]);

  const hasObjectiveScore = useMemo(
    () => selectedSnapshots.some((snap) => toFiniteNumber(snap.objective?.score) !== null),
    [selectedSnapshots],
  );

  const objectiveComponentKeys = useMemo<ObjectiveComponentKey[]>(() => {
    const orderedKeys: ObjectiveComponentKey[] = [];
    OBJECTIVE_COMPONENT_KEYS.forEach((key) => {
      const hasValue = selectedSnapshots.some(
        (snap) => getObjectiveComponentValue(snap.objective?.components, key) !== null,
      );
      if (hasValue) {
        orderedKeys.push(key);
      }
    });
    return orderedKeys;
  }, [selectedSnapshots]);

  const objectiveComponentBest = useMemo(() => {
    const bestMap = new Map<ObjectiveComponentKey, number>();
    objectiveComponentKeys.forEach((key) => {
      let best: number | null = null;
      selectedSnapshots.forEach((snap) => {
        const value = getObjectiveComponentValue(snap.objective?.components, key);
        if (value === null) return;
        if (best === null || value < best) {
          best = value;
        }
      });
      if (best !== null) {
        bestMap.set(key, best);
      }
    });
    return bestMap;
  }, [objectiveComponentKeys, selectedSnapshots]);

  const { objectiveRadarData, objectiveRadarMax } = useMemo(() => {
    type RadarDatum = { metric: string } & Record<string, number>;

    const rows: RadarDatum[] = [];
    let maxValue = 0;

    const metrics: Array<{
      key: ObjectiveComponentKey | "TOTAL_DELAY";
      label: string;
      getter: (snap: RegulationSnapshot) => number | null;
    }> = [
      {
        key: "TOTAL_DELAY",
        label: "Total Delay (min)",
        getter: (snap) => {
          const totalDelaySeconds = toFiniteNumber(snap.delayStats?.total_delay_seconds);
          return totalDelaySeconds !== null ? totalDelaySeconds / 60 : null;
        },
      },
      ...OBJECTIVE_COMPONENT_KEYS.map((key) => ({
        key,
        label: key.replace(/_/g, " "),
        getter: (snap: RegulationSnapshot) => getObjectiveComponentValue(snap.objective?.components, key),
      })),
    ];

    metrics.forEach((metric) => {
      const row: RadarDatum = { metric: metric.label };
      let hasValue = false;

      selectedSnapshots.forEach((snap) => {
        const value = metric.getter(snap);
        if (value !== null) {
          row[snap.id] = value;
          maxValue = Math.max(maxValue, value);
          hasValue = true;
        }
      });

      if (hasValue) {
        rows.push(row);
      }
    });

    return { objectiveRadarData: rows, objectiveRadarMax: maxValue };
  }, [selectedSnapshots]);

  const objectiveRadarDomainMax = useMemo(() => {
    if (objectiveRadarMax <= 0) return 1;
    return Math.max(1, Math.ceil(objectiveRadarMax * 1.1));
  }, [objectiveRadarMax]);

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
        if (!flight) {
          flight = flightsByCallsign.get(String(flightKey));
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

      map.set(snap.id, {
        departures,
        arrivals,
        totalFlights,
        totalDelay,
        averageDelay: totalFlights > 0 ? totalDelay / totalFlights : 0,
        heaviest,
        combinedEntries,
        chartTotalCount: combinedEntries.length,
        uniqueAirports: combinedEntries.length,
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
    [alignedSnapshots],
  );

  const airportComparisonChart = useMemo(() => {
    const totals = new Map<
      string,
      {
        airport: string;
        combinedDelay: number;
        combinedFlights: number;
        perSnapshot: Record<string, { delay: number; flights: number }>;
      }
    >();
    alignedSnapshots.forEach((snap) => {
      const stats = airportStatsBySnapshot.get(snap.id);
      if (!stats) return;
      stats.combinedEntries.forEach((entry) => {
        const key = entry.airport;
        let record = totals.get(key);
        if (!record) {
          record = {
            airport: key,
            combinedDelay: 0,
            combinedFlights: 0,
            perSnapshot: {},
          };
          totals.set(key, record);
        }
        const snapshotRecord = record.perSnapshot[snap.id] || { delay: 0, flights: 0 };
        snapshotRecord.delay = entry.total;
        snapshotRecord.flights = entry.totalFlights;
        record.perSnapshot[snap.id] = snapshotRecord;
        record.combinedDelay += entry.total;
        record.combinedFlights += entry.totalFlights;
      });
    });
    const entries = Array.from(totals.values());
    entries.sort((a, b) => {
      if (airportChartMetric === 'flights') {
        return b.combinedFlights - a.combinedFlights || a.airport.localeCompare(b.airport);
      }
      return b.combinedDelay - a.combinedDelay || a.airport.localeCompare(b.airport);
    });
    const chartLimit = 10;
    const data = entries.slice(0, chartLimit).map((entry) => {
      const row: Record<string, number | string> = { airport: entry.airport };
      alignedSnapshots.forEach((snap) => {
        const snapshotRecord = entry.perSnapshot[snap.id] || { delay: 0, flights: 0 };
        row[`total_${snap.id}`] = snapshotRecord.delay;
        row[`flights_${snap.id}`] = snapshotRecord.flights;
      });
      return row;
    });
    return { data, totalCount: entries.length };
  }, [alignedSnapshots, airportStatsBySnapshot, airportChartMetric]);

  const airportChartSeries = useMemo(
    () =>
      alignedSnapshots
        .filter((snap) => airportStatsBySnapshot.has(snap.id))
        .map((snap) => ({
          snapshot: snap,
          key: `${airportChartMetric === 'delay' ? 'total' : 'flights'}_${snap.id}`,
          label: snap.description || "Untitled",
          color: colorBySnapshotId.get(snap.id) || "#38bdf8",
        })),
    [alignedSnapshots, airportStatsBySnapshot, colorBySnapshotId, airportChartMetric],
  );

  const airportChartSeriesLookup = useMemo(() => {
    const map = new Map<string, string>();
    airportChartSeries.forEach((item) => {
      map.set(item.key, item.label);
    });
    return map;
  }, [airportChartSeries]);

  const chartMetricLabel = airportChartMetric === 'delay' ? 'combined delay' : 'delayed flights';
  const chartSummaryText =
    airportComparisonChart.totalCount === 0
      ? 'No airports to compare yet'
      : airportComparisonChart.totalCount > airportComparisonChart.data.length
        ? `Top ${airportComparisonChart.data.length} of ${airportComparisonChart.totalCount} airports by ${chartMetricLabel}`
        : `Airports by ${chartMetricLabel} (${airportComparisonChart.totalCount})`;
  const formatChartValue = (value: number) =>
    airportChartMetric === 'delay' ? formatAdaptive(value, 1) : formatFlights(value);
  const tooltipUnit = airportChartMetric === 'delay' ? 'min' : 'flights';

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

  const tvSeriesBySnapshot = useMemo(() => {
    const result = new Map<string, Record<string, number[]>>();
    alignedSnapshots.forEach((snap) => {
      const aggregated = snap.aggregatedRolling;
      const series: Record<string, number[]> = {};
      if (aggregated?.post_counts) {
        Object.entries(aggregated.post_counts).forEach(([tv, values]) => {
          if (!Array.isArray(values)) return;
          series[tv] = values.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
        });
      }
      result.set(snap.id, series);
    });
    return result;
  }, [alignedSnapshots]);

  const capacityBySnapshot = useMemo(() => {
    const map = new Map<string, Record<string, number[] | undefined>>();
    alignedSnapshots.forEach((snap) => {
      const aggregated = snap.aggregatedRolling;
      const cap: Record<string, number[] | undefined> = {};
      if (aggregated?.capacity) {
        Object.entries(aggregated.capacity).forEach(([tv, values]) => {
          if (!Array.isArray(values)) return;
          cap[tv] = values.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0));
        });
      }
      map.set(snap.id, cap);
    });
    return map;
  }, [alignedSnapshots]);

  const tvIdsUnion = useMemo(() => {
    const set = new Set<string>();
    alignedSnapshots.forEach((snap) => {
      const series = tvSeriesBySnapshot.get(snap.id) || {};
      Object.keys(series).forEach((tv) => set.add(tv));
    });
    return Array.from(set);
  }, [alignedSnapshots, tvSeriesBySnapshot]);

  const tvFilterOptions = useMemo<ChipOption[]>(() => {
    return tvIdsUnion
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .map((id) => ({ id, label: id }));
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

  const tvAbsChangeBySnapshot = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    alignedSnapshots.forEach((snap) => {
      const aggregated = snap.aggregatedRolling;
      if (!aggregated) {
        map.set(snap.id, {});
        return;
      }
      const pre = aggregated.pre_counts || {};
      const post = aggregated.post_counts || {};
      const tvIds = new Set<string>([...Object.keys(pre), ...Object.keys(post)]);
      const entries: Record<string, number> = {};
      const minutes = Number(aggregated.time_bin_minutes || minutesPerBin || snap.minutesPerBin || 15);
      tvIds.forEach((tvId) => {
        const preSeries = pre?.[tvId] || [];
        const postSeries = post?.[tvId] || [];
        const n = Math.min(preSeries.length, postSeries.length);
        let score = 0;
        for (let i = 0; i < n; i++) {
          const start = i * minutes;
          if (start < viewFromMin || start > viewToMin) continue;
          const a = Number(preSeries[i] ?? 0);
          const b = Number(postSeries[i] ?? 0);
          score += Math.abs((Number.isFinite(b) ? b : 0) - (Number.isFinite(a) ? a : 0));
        }
        entries[tvId] = score;
      });
      map.set(snap.id, entries);
    });
    return map;
  }, [alignedSnapshots, minutesPerBin, viewFromMin, viewToMin]);

  const tvRelativeChangeBySnapshot = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    alignedSnapshots.forEach((snap) => {
      const aggregated = snap.aggregatedRolling;
      if (!aggregated) {
        map.set(snap.id, {});
        return;
      }
      const pre = aggregated.pre_counts || {};
      const post = aggregated.post_counts || {};
      const tvIds = new Set<string>([
        ...Object.keys(pre || {}),
        ...Object.keys(post || {}),
      ]);
      const entries: Record<string, number> = {};
      if (tvIds.size === 0) {
        map.set(snap.id, entries);
        return;
      }
      const minutes = Number(aggregated.time_bin_minutes || minutesPerBin || snap.minutesPerBin || 15);
      tvIds.forEach((tvId) => {
        const preSeries = pre?.[tvId] || [];
        const postSeries = post?.[tvId] || [];
        const n = Math.min(preSeries.length, postSeries.length);
        let deltaSum = 0;
        let baseSum = 0;
        for (let i = 0; i < n; i++) {
          const start = i * minutes;
          if (start < viewFromMin || start > viewToMin) continue;
          const a = Number(preSeries[i] ?? 0);
          const b = Number(postSeries[i] ?? 0);
          const aa = Number.isFinite(a) ? a : 0;
          const bb = Number.isFinite(b) ? b : 0;
          deltaSum += Math.abs(bb - aa);
          baseSum += Math.abs(aa);
        }
        if (baseSum > 0) {
          entries[tvId] = deltaSum / baseSum;
        } else {
          entries[tvId] = deltaSum > 0 ? Number.MAX_SAFE_INTEGER : 0;
        }
      });
      map.set(snap.id, entries);
    });
    return map;
  }, [alignedSnapshots, minutesPerBin, viewFromMin, viewToMin]);

  const absChangeSortOptions = useMemo<ChangeSortOption[]>(() => {
    return alignedSnapshots.map((snap) => {
      const aggregated = snap.aggregatedRolling;
      const preCount = Object.keys(aggregated?.pre_counts || {}).length;
      const postCount = Object.keys(aggregated?.post_counts || {}).length;
      let disabled = false;
      let reason: string | undefined;
      if (!aggregated || postCount === 0) {
        disabled = true;
        reason = "Snapshot is missing post-rolling counts.";
      } else if (preCount === 0) {
        disabled = true;
        reason = "Snapshot is missing baseline rolling counts.";
      }
      return {
        value: `${ABS_CHANGE_PREFIX}${snap.id}` as TvSortMode,
        label: `Rank by Absolute Change (${snap.description || "Untitled"})`,
        disabled,
        reason,
        snapshotId: snap.id,
      };
    });
  }, [alignedSnapshots]);

  const relativeChangeSortOptions = useMemo<ChangeSortOption[]>(() => {
    return alignedSnapshots.map((snap) => {
      const aggregated = snap.aggregatedRolling;
      const preCount = Object.keys(aggregated?.pre_counts || {}).length;
      const postCount = Object.keys(aggregated?.post_counts || {}).length;
      let disabled = false;
      let reason: string | undefined;
      if (!aggregated || postCount === 0) {
        disabled = true;
        reason = "Snapshot is missing post-rolling counts.";
      } else if (preCount === 0) {
        disabled = true;
        reason = "Snapshot is missing baseline rolling counts.";
      }
      return {
        value: `${REL_CHANGE_PREFIX}${snap.id}` as TvSortMode,
        label: `Rank by Relative Change (${snap.description || "Untitled"})`,
        disabled,
        reason,
        snapshotId: snap.id,
      };
    });
  }, [alignedSnapshots]);

  useEffect(() => {
    const absSnapshotId = getAbsChangeSnapshotId(tvSort);
    if (absSnapshotId) {
      const option = absChangeSortOptions.find((opt) => opt.snapshotId === absSnapshotId);
      if (!option || option.disabled) {
        if (tvSort !== "exceedance") setTvSort("exceedance");
      }
      return;
    }
    const relSnapshotId = getRelativeChangeSnapshotId(tvSort);
    if (!relSnapshotId) return;
    const option = relativeChangeSortOptions.find((opt) => opt.snapshotId === relSnapshotId);
    if (!option || option.disabled) {
      if (tvSort !== "exceedance") setTvSort("exceedance");
    }
  }, [absChangeSortOptions, relativeChangeSortOptions, tvSort]);

  const filteredTvIds = useMemo(() => {
    let list = tvMetrics;
    if (hasTvFilter) {
      list = list.filter((item) => selectedTvSet.has(item.tvId));
    }
    const absChangeSnapshotId = getAbsChangeSnapshotId(tvSort);
    const absScores = absChangeSnapshotId ? tvAbsChangeBySnapshot.get(absChangeSnapshotId) || null : null;
    const relChangeSnapshotId = getRelativeChangeSnapshotId(tvSort);
    const relScores = relChangeSnapshotId ? tvRelativeChangeBySnapshot.get(relChangeSnapshotId) || null : null;
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
        const absMap = relChangeSnapshotId ? tvAbsChangeBySnapshot.get(relChangeSnapshotId) || {} : {};
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
    tvAbsChangeBySnapshot,
    tvRelativeChangeBySnapshot,
  ]);

  const visibleTvs = filteredTvIds.slice(0, visibleTvCount);
  const remainingTvCount = Math.max(0, filteredTvIds.length - visibleTvCount);

  if (!hydrated || !user) {
    return null;
  }

  return (
    <main className="min-h-screen w-screen overflow-x-hidden analytics-surface relative">
      <Header />
      <div className="pt-16 pb-12 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6">
            <div className="text-[11px] uppercase tracking-wider text-white/70">Analytics</div>
            <h1 className="text-2xl font-semibold text-white">Regulation Comparison</h1>
            <div className="text-[12px] text-white/60 mt-1">Compare up to {MAX_REG_SNAPSHOTS} saved regulation plan simulations.</div>
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
                    setExportText(exportRegSnapshots());
                    setExportOpen(true);
                  }}
                  className="px-2.5 py-1 rounded-md border border-white/20 bg-white/10 text-white/80 hover:bg-white/15"
                >Export</button>
                <button
                  onClick={() => { setImportText(""); setImportError(null); setImportOpen(true); }}
                  className="px-2.5 py-1 rounded-md border border-white/20 bg-white/10 text-white/80 hover:bg-white/15"
                >Import</button>
                <button
                  onClick={() => { clearRegSnapshots(); setSnapshots([]); setSelectedIds([]); }}
                  className="px-2.5 py-1 rounded-md border border-white/20 bg-red-500/20 text-red-100 hover:bg-red-500/30"
                >Clear all</button>
                <a
                  href="/regulations"
                  className="px-2.5 py-1 rounded-md border border-emerald-400/60 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/25"
                >Collect new snapshot</a>
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
                  No saved regulation results yet. Run a simulation and click “Add to Comparison” from the results modal.
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
                                  if (prev.length >= MAX_REG_SNAPSHOTS) return prev;
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
                              const next = updateRegSnapshotDescription(snap.id, val);
                              setSnapshots(next);
                            } catch (err) {
                              console.warn("Failed to rename regulation snapshot", err);
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
                              const next = deleteRegSnapshot(snap.id);
                              setSnapshots(next);
                            } catch (err) {
                              console.warn("Failed to delete regulation snapshot", err);
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
                              const reordered = reorderRegSnapshots(ids);
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
                              const reordered = reorderRegSnapshots(ids);
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
                        <div className="text-white/50 uppercase text-[10px] tracking-wider">Total delay (min)</div>
                        <div className="font-mono text-white/90">{formatNumber((snap.delayStats?.total_delay_seconds ?? 0) / 60, 1)}</div>
                      </div>
                      <div>
                        <div className="text-white/50 uppercase text-[10px] tracking-wider">Mean delay (min)</div>
                        <div className="font-mono text-white/90">{formatNumber((snap.delayStats?.mean_delay_seconds ?? 0) / 60, 2)}</div>
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
            </div>
            {hasObjectiveScore || objectiveComponentKeys.length > 0 ? (
              <div className="flex flex-col lg:flex-row gap-6">
                {/* Left side: Objective scores and component table */}
                <div className="flex-1 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {selectedSnapshots.map((snap) => {
                      const color = colorBySnapshotId.get(snap.id) || "#fff";
                      const score = toFiniteNumber(snap.objective?.score);
                      const isBest = bestObjectiveScore !== null && score !== null && score === bestObjectiveScore;
                      return (
                        <div key={snap.id} className="rounded-lg border border-white/10 bg-white/5 p-4 text-white/80 space-y-2">
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <span className="inline-flex w-2 h-2 rounded-full" style={{ background: color }} />
                            <span>{snap.description || "Untitled"}</span>
                            {isBest && <span className="text-[10px] uppercase tracking-wider bg-emerald-500/20 border border-emerald-400/60 px-1.5 py-0.5 rounded text-emerald-100">Best</span>}
                          </div>
                          <div className="text-[12px] text-white/60">Objective score</div>
                          <div className="text-2xl font-semibold text-white">{formatNumber(score, 2)}</div>
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
                            {selectedSnapshots.map((snap) => (
                              <th key={snap.id} className="text-left px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <span
                                    className="inline-flex w-2 h-2 rounded-full"
                                    style={{ background: colorBySnapshotId.get(snap.id) || "#fff" }}
                                  />
                                  <span>{snap.description || "Untitled"}</span>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {objectiveComponentKeys.map((key) => {
                            const bestValue = objectiveComponentBest.get(key);
                            return (
                              <tr key={key} className="border-t border-white/10">
                                <td className="px-3 py-2 text-white/70">{key}</td>
                                {selectedSnapshots.map((snap) => {
                                  const value = getObjectiveComponentValue(snap.objective?.components, key);
                                  const isBest =
                                    bestValue !== undefined &&
                                    bestValue !== null &&
                                    value !== null &&
                                    value === bestValue;
                                  return (
                                    <td
                                      key={`${snap.id}-${key}`}
                                      className={`px-3 py-2 font-mono text-[13px] ${isBest ? 'text-emerald-200' : 'text-white/80'}`}
                                    >
                                      {formatNumber(value, 3)}
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
                      <div className="text-sm font-medium text-white/80 mb-3">Delay vs Objective Components</div>
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
                            />
                            <Tooltip
                              formatter={(value: unknown) =>
                                typeof value === "number" ? formatNumber(value, 2) : value
                              }
                              wrapperClassName="text-sm"
                            />
                            {selectedSnapshots.map((snap) => {
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
                        {selectedSnapshots.map((snap) => {
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
            ) : (
              <div className="mt-4 text-sm text-white/60">Objective metrics not available for the selected snapshots.</div>
            )}
          </section>

          <section className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Delay summary</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
              {selectedSnapshots.map((snap) => {
                const color = colorBySnapshotId.get(snap.id) || "#fff";
                const stats = snap.delayStats;
                const totalSeconds = stats?.total_delay_seconds ?? 0;
                const meanSeconds = stats?.mean_delay_seconds ?? 0;
                const maxSeconds = stats?.max_delay_seconds ?? 0;
                const minSeconds = stats?.min_delay_seconds ?? 0;
                const delayedFlights = stats?.delayed_flights_count ?? 0;
                const totalFlights = stats?.num_flights ?? 0;
                const isBestTotal = bestTotalDelaySeconds != null && totalSeconds === bestTotalDelaySeconds;
                const isBestMean = bestMeanDelaySeconds != null && meanSeconds === bestMeanDelaySeconds;
                return (
                  <div key={snap.id} className="rounded-lg border border-white/10 bg-white/5 p-4 text-white/80 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <span className="inline-flex w-2 h-2 rounded-full" style={{ background: color }} />
                      <span>{snap.description || "Untitled"}</span>
                      {isBestTotal && <span className="text-[10px] uppercase tracking-wider bg-emerald-500/20 border border-emerald-400/60 px-1.5 py-0.5 rounded text-emerald-100">Lowest total</span>}
                    </div>
                    <div className="text-[12px] text-white/60">Total delay</div>
                    <div className="text-2xl font-semibold text-white">{formatNumber(totalSeconds / 60, 1)} min</div>
                    <div className="text-[12px] text-white/60">{formatSecondsToHMM(totalSeconds)}</div>
                    <div className={`text-sm ${isBestMean ? 'text-emerald-300' : 'text-white/70'}`}>Mean {formatNumber(meanSeconds / 60, 2)} min</div>
                    <div className="text-[12px] text-white/70">Max {formatNumber(maxSeconds / 60, 2)} min</div>
                    <div className="text-[12px] text-white/70">Min {formatNumber(minSeconds / 60, 2)} min</div>
                    <div className="text-[12px] text-white/70">Delayed flights {delayedFlights.toLocaleString()} / {totalFlights.toLocaleString()}</div>
                  </div>
                );
              })}
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
                    } rounded-r-md`}
                  >
                    By Airport
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
                            <span>{snap.description || "Untitled"}</span>
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
            ) : (
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
                                <div className="text-[12px] text-white/60">
                                  Total delay {formatAdaptive(stats.totalDelay, 1)} min • Avg {formatAverage(stats.averageDelay)} min
                                </div>
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
                    {airportComparisonChart.data.length > 0 && airportChartSeries.length > 0 && (
                      <div className="bg-white/5 border border-white/10 rounded-lg p-4">
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
                        <div className="h-72">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={airportComparisonChart.data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                              <XAxis dataKey="airport" tick={{ fontSize: 11, fill: '#e2e8f0' }} axisLine={{ stroke: 'rgba(255,255,255,0.2)' }} tickLine={false} />
                              <YAxis
                                tick={{ fontSize: 11, fill: '#e2e8f0' }}
                                tickFormatter={(value: number) => formatChartValue(value)}
                                axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                                tickLine={false}
                                allowDecimals={airportChartMetric === 'delay'}
                              />
                              <Tooltip
                                formatter={(value: number, name: string) => [
                                  `${formatChartValue(Number(value))} ${tooltipUnit}`,
                                  airportChartSeriesLookup.get(name) || name,
                                ]}
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
                                    ...alignedSnapshots.map((snap) => row.perSnapshot[snap.id]?.totalDelay ?? Number.POSITIVE_INFINITY),
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
                                                <div className="font-mono text-[13px]">{formatAdaptive(cell.totalDelay, 1)} min</div>
                                                <div className="text-[11px] text-white/60">
                                                  Flights {formatFlights(cell.flightCount)} · Avg {formatAverage(cell.averageDelay)} · Max {formatAdaptive(cell.maxDelay, 1)} · Min {formatAdaptive(cell.minDelay, 1)}
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
                                    ...alignedSnapshots.map((snap) => row.perSnapshot[snap.id]?.totalDelay ?? Number.POSITIVE_INFINITY),
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
                                                <div className="font-mono text-[13px]">{formatAdaptive(cell.totalDelay, 1)} min</div>
                                                <div className="text-[11px] text-white/60">
                                                  Flights {formatFlights(cell.flightCount)} · Avg {formatAverage(cell.averageDelay)} · Max {formatAdaptive(cell.maxDelay, 1)} · Min {formatAdaptive(cell.minDelay, 1)}
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

            {visibleTvs.length === 0 && (
              <div className="text-sm text-white/60 bg-white/5 border border-white/10 rounded-lg p-4">
                No traffic volumes match the current filters.
              </div>
            )}
            {visibleTvs.length === 0 && alignedSnapshots.length > 0 && tvIdsUnion.length === 0 && (
              <div className="text-sm text-amber-200 bg-amber-500/10 border border-amber-400/30 rounded-lg p-4 mt-3">
                The selected snapshots do not include rolling occupancy data. Save new snapshots after rerunning the simulation.
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
                    entry.capacity = Number(capacitySeries[i] ?? 0);
                    if (entry.capacity) hasValue = true;
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
                    const cap = Number(capacity?.[i] ?? Number.POSITIVE_INFINITY);
                    if (Number.isFinite(cap)) {
                      exceedance += Math.max(0, val - cap) * normalizationFactor;
                    }
                  }
                  return { snap, peak, exceedance };
                });

                const hasCapacity = Array.isArray(capacitySeries) && capacitySeries.length > 0;
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
                    <div className="space-y-1 text-[12px] text-white/70">
                      {legendMetrics.map(({ snap, peak, exceedance }) => (
                        <div key={snap.id} className="flex items-center gap-2">
                          <span className="inline-flex w-2 h-2 rounded-full" style={{ background: colorBySnapshotId.get(snap.id) || '#fff' }} />
                          <span className="text-white/80">{snap.description || 'Untitled'}</span>
                          <span className="text-white/60">Peak {formatNumber(peak, 1)}</span>
                          <span className="text-white/60">Exceedance {formatNumber(exceedance, 1)}</span>
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

            {alignedSnapshots.length !== selectedSnapshots.length && (
              <div className="mt-4 text-[12px] text-amber-200">
                Ignoring {selectedSnapshots.length - alignedSnapshots.length} snapshot(s) with mismatched bin sizes for charts and tables.
              </div>
            )}
          </section>
        </div>
      </div>

      <ModalDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export snapshots"
        description="Copy JSON to share or back up your saved regulation results"
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
                  const filename = `reg_snapshots_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
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
                  const next = importRegSnapshots(importText);
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
