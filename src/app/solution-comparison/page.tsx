"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import TimeScaleControl from "@/components/TimeScaleControl";
import ModalDialog from "@/components/ModalDialog";
import MultiSelectWithChips, { ChipOption } from "@/components/MultiSelectWithChips";
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
import { loadTrajectories } from "@/lib/flights";
import { hhmmToMinutesSafe, minutesToHHMM, binIndexToRangeLabel } from "@/lib/time";
import { ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Bar, Line } from "recharts";

const PALETTE = ["#38bdf8", "#f472b6", "#facc15", "#34d399"];

type OccupancyScope = "aggregate" | "targets" | "ripples";
type FlightSortMode = "max" | "diff" | "callsign";
type TvSortMode = "exceedance" | "peak" | "alphabetical";

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

function formatNumber(val: number | null | undefined, digits = 2) {
  if (val === null || val === undefined || Number.isNaN(val)) return "—";
  if (!Number.isFinite(val)) return "∞";
  return Number(val).toFixed(digits);
}

export default function SolutionComparisonPage() {
  const router = useRouter();
  const user = useSimStore((state) => state.user);
  const { flights, setFlights, setRange } = useSimStore();
  const [hydrated, setHydrated] = useState(false);

  const [snapshots, setSnapshots] = useState<SolutionSnapshot[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewFrom, setViewFrom] = useState("00:00");
  const [viewTo, setViewTo] = useState("23:59");
  const [tvScope, setTvScope] = useState<OccupancyScope>("aggregate");
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
        const tracks = await loadTrajectories("/data/flights_20230801.csv");
        if (cancelled) return;
        setFlights(tracks);
        if (tracks && tracks.length > 0) {
          const minT = Math.min(...tracks.map((tr: any) => tr.t0));
          const maxT = Math.max(...tracks.map((tr: any) => tr.t1));
          setRange([minT, maxT], minT);
        }
      } catch (e) {
        console.warn("Failed to load flight trajectories for comparison page", e);
      }
    })();
    return () => { cancelled = true; };
  }, [flights.length, setFlights, setRange]);

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

  const minutesPerBin = minutesBySnapshot.dominant || (alignedSnapshots[0]?.minutesPerBin ?? 15);
  const viewFromMin = hhmmToMinutesSafe(viewFrom);
  const viewToMin = hhmmToMinutesSafe(viewTo);

  const flightsById = useMemo(() => {
    const map = new Map<string, any>();
    for (const fl of flights) {
      if (fl?.flightId) map.set(String(fl.flightId), fl);
    }
    return map;
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

  const objectiveComponentKeys = useMemo(() => {
    const keys = new Set<string>();
    alignedSnapshots.forEach((snap) => {
      const baseline = snap.objective.baseline?.components || {};
      const optimized = snap.objective.optimized?.components || {};
      Object.keys(baseline).forEach((k) => keys.add(k));
      Object.keys(optimized).forEach((k) => keys.add(k));
    });
    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  }, [alignedSnapshots]);

  const bestOptimizedScore = useMemo(() => {
    if (alignedSnapshots.length === 0) return null;
    return Math.min(...alignedSnapshots.map((snap) => snap.objective.optimized?.score ?? Number.POSITIVE_INFINITY));
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

  const filteredTvIds = useMemo(() => {
    let list = tvMetrics;
    if (hasTvFilter) {
      list = list.filter((item) => selectedTvSet.has(item.tvId));
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (tvSort === "alphabetical") {
        return a.tvId.localeCompare(b.tvId);
      }
      if (tvSort === "peak") {
        if (b.maxPeak !== a.maxPeak) return b.maxPeak - a.maxPeak;
        return b.maxExceedance - a.maxExceedance;
      }
      if (b.maxExceedance !== a.maxExceedance) return b.maxExceedance - a.maxExceedance;
      return b.maxPeak - a.maxPeak;
    });
    return sorted.map((item) => item.tvId);
  }, [tvMetrics, hasTvFilter, selectedTvSet, tvSort]);

  const visibleTvs = filteredTvIds.slice(0, visibleTvCount);

  if (!hydrated || !user) {
    return null;
  }

  return (
    <main className="min-h-screen w-screen overflow-x-hidden bg-slate-900 relative">
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
                  className="px-2.5 py-1 rounded-md border border-white/20 bg-white/10 text-white/80 hover:bg-white/15"
                >Export</button>
                <button
                  onClick={() => { setImportText(""); setImportError(null); setImportOpen(true); }}
                  className="px-2.5 py-1 rounded-md border border-white/20 bg-white/10 text-white/80 hover:bg-white/15"
                >Import</button>
                <button
                  onClick={() => { clearSnapshots(); setSnapshots([]); setSelectedIds([]); }}
                  className="px-2.5 py-1 rounded-md border border-white/20 bg-red-500/20 text-red-100 hover:bg-red-500/30"
                >Clear all</button>
                <a
                  href="/flow-evaluation"
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

          <section className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Objective comparison</h2>
              {alignedSnapshots.length !== selectedSnapshots.length && (
                <div className="text-[12px] text-amber-200">Ignoring {selectedSnapshots.length - alignedSnapshots.length} snapshot(s) with mismatched bin sizes.</div>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
              {alignedSnapshots.map((snap) => {
                const color = colorBySnapshotId.get(snap.id) || "#fff";
                const baseline = snap.objective.baseline?.score ?? null;
                const optimized = snap.objective.optimized?.score ?? null;
                const delta = (baseline != null && optimized != null) ? optimized - baseline : null;
                const pct = (baseline != null && optimized != null && baseline !== 0)
                  ? ((optimized - baseline) / Math.abs(baseline)) * 100
                  : null;
                const isBest = optimized != null && bestOptimizedScore != null && optimized === bestOptimizedScore;
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
                    <div className={`text-sm ${delta != null && delta < 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      Δ {formatNumber(delta, 2)} ({formatNumber(pct, 1)}%)
                    </div>
                  </div>
                );
              })}
            </div>

            {objectiveComponentKeys.length > 0 && (
              <div className="mt-6 overflow-x-auto">
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
                      const bestValue = Math.min(...alignedSnapshots.map((snap) => snap.objective.optimized?.components?.[key] ?? Number.POSITIVE_INFINITY));
                      return (
                        <tr key={key} className="border-t border-white/10">
                          <td className="px-3 py-2 text-white/70">{key}</td>
                          {alignedSnapshots.map((snap) => {
                            const baselineVal = snap.objective.baseline?.components?.[key] ?? null;
                            const optimizedVal = snap.objective.optimized?.components?.[key] ?? null;
                            const delta = (baselineVal != null && optimizedVal != null) ? optimizedVal - baselineVal : null;
                            const isBest = optimizedVal != null && optimizedVal === bestValue;
                            return (
                              <td key={snap.id} className={`px-3 py-2 font-mono text-[13px] ${isBest ? 'text-emerald-200' : 'text-white/80'}`}>
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
          </section>

          <section className="bg-white/5 border border-white/10 rounded-xl p-4 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Flight delay comparison</h2>
              <div className="flex flex-wrap items-center gap-3 text-[12px] text-white/70">
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
              </div>
            </div>
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
                    entry.capacity = Number(capacitySeries[i] ?? 0);
                    if (entry.capacity) hasValue = true;
                  }
                  if (hasValue) chartData.push(entry);
                }

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
                      exceedance += Math.max(0, val - cap);
                    }
                  }
                  return { snap, peak, exceedance };
                });

                const hasCapacity = Array.isArray(capacitySeries) && capacitySeries.length > 0;
                const hasSeries = alignedSnapshots.some((snap) => (tvSeriesBySnapshot.get(snap.id)?.[tvId] || []).length > 0);

                return (
                  <div key={tvId} className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-white">{tvId}</div>
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
                >Show more</button>
              </div>
            )}
          </section>
        </div>
      </div>

      <ModalDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export snapshots"
        width="w-[min(720px,95vw)]"
        height="h-auto max-h-[80vh]"
      >
        <div className="p-6 space-y-4 text-sm">
          <p className="text-white/70">Copy the JSON below to share or backup your saved solutions.</p>
          <textarea
            value={exportText}
            onChange={(e) => setExportText(e.currentTarget.value)}
            className="w-full min-h-[320px] bg-black/40 border border-white/20 rounded-lg p-3 font-mono text-xs text-white"
          />
          <div className="flex justify-end">
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
        width="w-[min(720px,95vw)]"
        height="h-auto max-h-[80vh]"
      >
        <div className="p-6 space-y-4 text-sm">
          <p className="text-white/70">Paste snapshot JSON exported from this tool. Import replaces your current stored snapshots.</p>
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
