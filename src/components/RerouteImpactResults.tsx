"use client";

import { useEffect, useMemo, useState } from "react";

import ModalDialog from "@/components/ModalDialog";
import OccupancyPrePostPanel, {
  type OccupancyPrePostSortMode,
} from "@/components/OccupancyPrePostPanel";
import TimeScaleControl from "@/components/TimeScaleControl";
import type {
  RerouteImpactDetouredFlight,
  RerouteImpactDiagnosticsFlight,
  RerouteImpactResponse,
} from "@/lib/rerouteImpact";

type RerouteImpactResultsProps = {
  open: boolean;
  result: RerouteImpactResponse | null;
  onClose: () => void;
};

type FlightRow = {
  flightId: string;
  status: string;
  intervalCount: number;
  blockedIntervalCount: number | null;
  polygonIds: string[];
  distanceDeltaNm: number | null;
  elapsedDeltaS: number | null;
};

export default function RerouteImpactResults({
  open,
  result,
  onClose,
}: RerouteImpactResultsProps) {
  const [minimized, setMinimized] = useState(false);
  const [viewFrom, setViewFrom] = useState("00:00");
  const [viewTo, setViewTo] = useState("23:59");
  const [sortMode, setSortMode] = useState<OccupancyPrePostSortMode>("abs_change");
  const [diagExpanded, setDiagExpanded] = useState(true);

  useEffect(() => {
    if (!open || !result) return;
    setMinimized(false);
    setViewFrom("00:00");
    setViewTo("23:59");
    setSortMode("abs_change");
    setDiagExpanded(true);
  }, [open, result]);

  const summary = result?.diagnostics?.summary ?? null;
  const missingFlightIds = useMemo(
    () => (summary?.missing_flight_ids || []).map((flightId) => String(flightId)).filter(Boolean),
    [summary],
  );

  const flightRows = useMemo<FlightRow[]>(() => {
    if (!result) return [];
    const detouredFlights = result.detoured_segments?.flights || {};
    const diagnosticFlights = result.diagnostics?.flights || {};
    const orderedFlightIds = dedupeStrings([
      ...(result.flight_ids || []),
      ...Object.keys(detouredFlights),
      ...Object.keys(diagnosticFlights),
    ]);

    return orderedFlightIds.map((flightId) => {
      const detouredFlight = detouredFlights[flightId];
      const diagnosticFlight = diagnosticFlights[flightId];
      const isMissing = missingFlightIds.includes(flightId);
      const polygonIds = dedupeStrings([
        ...(Array.isArray(diagnosticFlight?.polygons_touched) ? diagnosticFlight.polygons_touched : []),
        ...collectIntervalPolygonIds(detouredFlight),
      ]);

      return {
        flightId,
        status: isMissing ? "missing" : resolveFlightStatus(detouredFlight, diagnosticFlight),
        intervalCount: toInteger(detouredFlight?.interval_count, Array.isArray(detouredFlight?.intervals) ? detouredFlight.intervals.length : 0),
        blockedIntervalCount: toNullableInteger(diagnosticFlight?.blocked_interval_count),
        polygonIds,
        distanceDeltaNm: toNullableNumber(diagnosticFlight?.distance_delta_nm),
        elapsedDeltaS: toNullableNumber(diagnosticFlight?.elapsed_delta_s),
      };
    });
  }, [missingFlightIds, result]);

  const changedTvCount = result?.tv_ids_order?.length ?? 0;
  const canShowOccupancy = changedTvCount > 0;
  const hasBothPrePost = useMemo(() => {
    const pre = result?.rolling_hour?.pre_counts || {};
    const post = result?.rolling_hour?.post_counts || {};
    const hasPre = Object.values(pre).some((series) => Array.isArray(series) && series.length > 0);
    const hasPost = Object.values(post).some((series) => Array.isArray(series) && series.length > 0);
    return hasPre && hasPost;
  }, [result?.rolling_hour?.pre_counts, result?.rolling_hour?.post_counts]);
  const hasCapacity = useMemo(() => {
    const capacity = result?.capacity || {};
    return Object.values(capacity).some(
      (series) =>
        Array.isArray(series) &&
        series.some((value) => Number.isFinite(Number(value))),
    );
  }, [result?.capacity]);

  const handleClose = () => {
    setMinimized(false);
    onClose();
  };

  const minimizeButton = (
    <button
      type="button"
      onClick={() => setMinimized(true)}
      title="Minimize"
      aria-label="Minimize"
      className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 12H6" />
      </svg>
    </button>
  );

  if (!open || !result) return null;

  return (
    <>
      <ModalDialog
        open={open && !minimized}
        onClose={handleClose}
        title="Reroute Impact Simulation"
        description="Post-reroute occupancy changes and per-flight diagnostics."
        headerActions={minimizeButton}
        width="w-[min(1180px,95vw)]"
        height="h-[min(860px,92vh)]"
      >
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            <MetricCard
              label="Requested Flights"
              value={formatInteger(summary?.requested_flight_count ?? result.flight_ids.length)}
            />
            <MetricCard
              label="Rerouted Flights"
              value={formatInteger(summary?.rerouted_flight_count ?? result.detoured_segments?.rerouted_flight_count ?? 0)}
            />
            <MetricCard
              label="Changed TVs"
              value={formatInteger(summary?.changed_tv_count ?? result.tv_ids_order.length)}
            />
            <MetricCard
              label="Polygons"
              value={formatInteger(summary?.requested_polygon_count ?? result.barred_polygon_ids.length)}
            />
            <MetricCard
              label="Time Bin"
              value={`${formatInteger(result.time_bin_minutes)} min`}
            />
          </div>

          {missingFlightIds.length > 0 ? (
            <div className="rounded-xl border border-amber-300/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              <div className="font-medium">Missing requested flights</div>
              <div className="mt-1 break-words text-xs text-amber-100/85">
                {missingFlightIds.join(", ")}
              </div>
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-sm uppercase tracking-wider text-gray-300">
                Rolling-hour Occupancy Diff (Post vs Pre)
              </div>
              {canShowOccupancy ? (
                <div className="ml-auto flex items-center gap-2">
                  <div className="text-[11px] uppercase tracking-wider text-white/60">TV Sort</div>
                  <select
                    className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[12px] text-white/90 focus:outline-none"
                    value={sortMode}
                    onChange={(event) => setSortMode(event.currentTarget.value as OccupancyPrePostSortMode)}
                  >
                    <option value="total">Rank by Total</option>
                    <option value="abs_change" disabled={!hasBothPrePost}>Rank by Absolute Changes</option>
                    <option value="relative_change" disabled={!hasBothPrePost}>Rank by Relative Changes</option>
                    <option value="total_excess_reduced" disabled={!hasBothPrePost || !hasCapacity}>Total Excess Reduced</option>
                    <option value="total_excess_induced" disabled={!hasBothPrePost || !hasCapacity}>Total Excess Induced</option>
                    <option value="exceedance">By Exceedances</option>
                  </select>
                </div>
              ) : null}
            </div>

            <TimeScaleControl
              time_from={viewFrom}
              time_to={viewTo}
              onCommit={(from, to) => {
                setViewFrom(from);
                setViewTo(to);
              }}
            />

            {canShowOccupancy ? (
              <OccupancyPrePostPanel
                postCounts={result.rolling_hour?.post_counts || {}}
                preCounts={result.rolling_hour?.pre_counts || {}}
                capacity={result.capacity}
                hotspotDiffs={result}
                tvOrder={result.tv_ids_order || []}
                binMinutes={result.time_bin_minutes}
                viewFrom={viewFrom}
                viewTo={viewTo}
                sortMode={sortMode}
                defaultSortMode="abs_change"
                initialLimit={12}
                compact
                showReliefMap
                reliefMapTitle="Reroute Impact Relief Map"
              />
            ) : (
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/70">
                No traffic volumes changed for this simulated reroute scenario.
              </div>
            )}
          </div>

          <div className="space-y-3">
            <button
              type="button"
              className="flex w-full items-center justify-between text-sm uppercase tracking-wider text-gray-300 hover:text-white transition-colors"
              onClick={() => setDiagExpanded((v) => !v)}
              aria-expanded={diagExpanded}
            >
              <span>Per-flight Diagnostics</span>
              <svg
                className={`h-4 w-4 text-white/70 transition-transform ${diagExpanded ? "rotate-90" : ""}`}
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
            {diagExpanded && (flightRows.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/70">
                No per-flight diagnostics were returned by the simulation.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/5">
                <table className="min-w-full text-sm text-white/85">
                  <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/55">
                    <tr>
                      <th className="px-3 py-2 text-left">Flight</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-right">Intervals</th>
                      <th className="px-3 py-2 text-right">Blocked</th>
                      <th className="px-3 py-2 text-left">Polygons</th>
                      <th className="px-3 py-2 text-right">Delta NM</th>
                      <th className="px-3 py-2 text-right">Delta Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flightRows.map((row) => (
                      <tr key={row.flightId} className="border-t border-white/10">
                        <td className="px-3 py-2 font-mono text-white/95">{row.flightId}</td>
                        <td className="px-3 py-2">
                          <StatusPill status={row.status} />
                        </td>
                        <td className="px-3 py-2 text-right">{formatInteger(row.intervalCount)}</td>
                        <td className="px-3 py-2 text-right">
                          {row.blockedIntervalCount === null ? "—" : formatInteger(row.blockedIntervalCount)}
                        </td>
                        <td className="px-3 py-2 text-white/70">
                          {row.polygonIds.length > 0 ? row.polygonIds.join(", ") : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {row.distanceDeltaNm === null ? "—" : formatNumber(row.distanceDeltaNm, 1)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {row.elapsedDeltaS === null ? "—" : formatSeconds(row.elapsedDeltaS)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      </ModalDialog>

      {open && minimized ? (
        <div className="fixed bottom-4 right-4 z-[10000] w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-slate-900/95 p-4 text-white shadow-[0_24px_80px_-32px_rgba(59,130,246,0.8)] backdrop-blur-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Reroute Impact Simulation</div>
              <div className="mt-1 text-xs text-white/60">
                {formatInteger(summary?.rerouted_flight_count ?? result.detoured_segments?.rerouted_flight_count ?? 0)} rerouted flights,{" "}
                {formatInteger(summary?.changed_tv_count ?? result.tv_ids_order.length)} changed TVs
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMinimized(false)}
                className="rounded-lg border border-cyan-300/30 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-100 transition-colors hover:bg-cyan-500/25"
              >
                Restore
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/85 transition-colors hover:bg-white/15"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function MetricCard(props: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-white/55">{props.label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{props.value}</div>
    </div>
  );
}

function StatusPill(props: { status: string }) {
  const normalized = props.status.toLowerCase();
  const className =
    normalized === "rerouted"
      ? "border-cyan-300/40 bg-cyan-500/15 text-cyan-100"
      : normalized === "unchanged"
        ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-100"
        : normalized === "missing"
          ? "border-amber-300/40 bg-amber-500/15 text-amber-100"
          : "border-white/20 bg-white/10 text-white/75";

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${className}`}>
      {normalized}
    </span>
  );
}

function resolveFlightStatus(
  detouredFlight: RerouteImpactDetouredFlight | undefined,
  diagnosticFlight: RerouteImpactDiagnosticsFlight | undefined,
): string {
  const detouredStatus = String(detouredFlight?.status ?? "").trim();
  if (detouredStatus) return detouredStatus;

  const diagnosticStatus = String(diagnosticFlight?.status ?? "").trim();
  if (diagnosticStatus) return diagnosticStatus;

  return "unknown";
}

function collectIntervalPolygonIds(detouredFlight: RerouteImpactDetouredFlight | undefined): string[] {
  const polygonIds: string[] = [];
  for (const interval of detouredFlight?.intervals || []) {
    for (const polygonId of interval?.polygon_ids || []) {
      const normalized = String(polygonId ?? "").trim();
      if (normalized) polygonIds.push(normalized);
    }
  }
  return polygonIds;
}

function dedupeStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values || []) {
    const normalized = String(value ?? "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function toInteger(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.trunc(fallback);
  return Math.trunc(numeric);
}

function toNullableInteger(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.trunc(numeric);
}

function toNullableNumber(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function formatInteger(value: number): string {
  return Math.trunc(value).toLocaleString("en-US");
}

function formatNumber(value: number, digits = 1): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatSeconds(value: number): string {
  const totalSeconds = Math.max(0, Math.round(value));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
