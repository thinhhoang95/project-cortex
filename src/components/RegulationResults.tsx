"use client";
import { useEffect, useMemo, useState } from "react";
// charts are handled by OccupancyPrePostPanel
import { RegulationPlanSimulationResponse } from "@/lib/models";
import { useSimStore } from "@/components/useSimStore";
import ModalDialog from "./ModalDialog";
import OccupancyPrePostPanel from "@/components/OccupancyPrePostPanel";
import TimeScaleControl from "@/components/TimeScaleControl";
import { minutesToHHMM } from "@/lib/time";
import ShimmeringText from "./ShimmeringText";
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

export default function RegulationResults({ open, result, onClose }: RegulationResultsProps) {
  const flights = useSimStore(s => s.flights);
  const regulations = useSimStore(s => s.regulations);
  const [viewFrom, setViewFrom] = useState<string>("00:00");
  const [viewTo, setViewTo] = useState<string>("23:59");
  const [sortMode, setSortMode] = useState<'total' | 'abs_change' | 'exceedance'>("abs_change");
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
    const rows = Object.entries(byFlight).map(([flightId, delaySecondsRaw]) => {
      const delaySeconds = Number(delaySecondsRaw) || 0;
      const f = flights.find(ff => String(ff.flightId) === String(flightId));
      const callsign = f?.callSign ? String(f?.callSign) : String(flightId);
      const origin = f?.origin ? String(f.origin) : '-';
      const destination = f?.destination ? String(f.destination) : '-';
      const ctx = result?.pre_flight_context?.[String(flightId)];
      const takeoffTime = ctx?.takeoff_time || '-';
      const tvArrivalTime = ctx?.tv_arrival_time || '-';
      const tvArrivalSeconds = parseTimeToSeconds(ctx?.tv_arrival_time);
      return { flightId: String(flightId), callsign, origin, destination, delaySeconds, takeoffTime, tvArrivalTime, tvArrivalSeconds };
    });
    rows.sort((a, b) => {
      const da = a.tvArrivalSeconds;
      const db = b.tvArrivalSeconds;
      if (da === db) return a.delaySeconds - b.delaySeconds;
      return da - db; // earliest first; Infinity (unknown) pushed to end
    });
    return rows;
  }, [result, flights]);

  const regSnapshotCount = regSnapshotList.length;

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
    try {
      const description = regSnapshotDescription.trim() || `Regulation Plan ${regSnapshotList.length + 1}`;
      const snapshot = createRegulationSnapshot({
        description,
        result,
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
    } catch (err: any) {
      if (err instanceof RegSnapshotLimitError) {
        setRegSnapshotSaveError(`Only ${err.limit} snapshots can be stored. Select one to replace or remove an existing snapshot.`);
      } else {
        setRegSnapshotSaveError(err?.message || "Failed to save snapshot.");
      }
    } finally {
      setRegSnapshotSaving(false);
    }
  };

  if (!open || !result) return null;

  const ds = result.delay_stats;

  return (
    <>
      <ModalDialog open={open} onClose={onClose} title="Simulation Results">
        <div className="p-6 space-y-6">
        {/* Delay stats */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="text-sm uppercase tracking-wider text-gray-300">Delay Stats</div>
            <button
              onClick={handleOpenRegSnapshotPrompt}
              disabled={regSnapshotSaving}
              className={`ml-auto px-3 py-1 rounded-lg border text-xs flex items-center gap-2 ${regSnapshotSaving ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100' : 'border-emerald-400/70 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/25'}`}
            >
              {regSnapshotSaving ? <ShimmeringText text="Saving…" /> : "Add to Comparison"}
              <span className={`px-2 py-0.5 rounded-full text-[11px] border ${regSnapshotSizeWarn ? 'border-amber-300/70 bg-amber-500/20 text-amber-100' : 'border-emerald-300/70 bg-emerald-400/10 text-emerald-100'}`}>
                {regSnapshotCount}/{MAX_REG_SNAPSHOTS}
              </span>
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Stat label="Total Delay" value={`${Math.round(ds.total_delay_seconds).toLocaleString()} s`} sub={formatSecondsToHMM(ds.total_delay_seconds)} />
            <Stat label="Mean Delay" value={`${Math.round(ds.mean_delay_seconds).toLocaleString()} s`} sub={formatSecondsToHMM(ds.mean_delay_seconds)} />
            <Stat label="Max Delay" value={`${Math.round(ds.max_delay_seconds).toLocaleString()} s`} sub={formatSecondsToHMM(ds.max_delay_seconds)} />
            <Stat label="Min Delay" value={`${Math.round(ds.min_delay_seconds).toLocaleString()} s`} sub={formatSecondsToHMM(ds.min_delay_seconds)} />
            <Stat label="Delayed Flights" value={`${ds.delayed_flights_count.toLocaleString()}`} />
            <Stat label="Flights" value={`${ds.num_flights.toLocaleString()}`} />
          </div>
        </div>

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
                    onChange={(e) => setSortMode(e.currentTarget.value as any)}
                  >
                    <option value="total">Rank by Total</option>
                    <option value="abs_change" disabled={!hasBoth}>Rank by Absolute Changes</option>
                    <option value="exceedance" disabled={!hasCap}>By Exceedances</option>
                  </select>
                );
              })()}
            </div>
          </div>
          <TimeScaleControl
            time_from={viewFrom}
            time_to={viewTo}
            onChange={(f, t) => { setViewFrom(f); setViewTo(t); }}
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
              if (Array.isArray(tv.capacity_per_bin)) capacity[id] = tv.capacity_per_bin;
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
                tvOrder={tvOrder}
                binMinutes={binMinutes}
                viewFrom={viewFrom}
                viewTo={viewTo}
                sortMode={sortMode}
                defaultSortMode="abs_change"
                initialLimit={12}
                compact
              />
            );
          })()}
        </div>


        {/* Delay assignment table */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4">
          <div className="text-sm uppercase tracking-wider text-gray-300 mb-3">Delay Assignment</div>
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
                      <td className="p-2 font-mono">{Math.round(r.delaySeconds).toLocaleString()}</td>
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-900/30 rounded-lg p-3 border border-white/10">
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-xs text-gray-300">{sub}</div>}
    </div>
  );
}
