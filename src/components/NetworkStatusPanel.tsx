"use client";
import { Clock3, Plane, PlaneLanding } from "lucide-react";
import { useMemo, useState } from "react";
import { formatSeeMoreLabel, SEE_LESS_LABEL } from "@/lib/seeMoreLess";
import {
  buildNetworkStatusDelayCauseRows,
  type NetworkStatusDelayCause,
  type NetworkStatusHistogramBin,
} from "@/lib/networkStatus";
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";

const DEFAULT_DELAY_CAUSES = buildNetworkStatusDelayCauseRows();

type NetworkStatusPanelProps = {
  embedded?: boolean;
  flightsTotal?: number;
  flightsLanded?: number;
  flightsAirborne?: number;
  averageDelayMinutes?: number | null;
  delayCauses?: NetworkStatusDelayCause[];
  delayHistogram?: NetworkStatusHistogramBin[];
};

export default function NetworkStatusPanel({
  embedded = true,
  flightsTotal = 0,
  flightsLanded = 0,
  flightsAirborne = 0,
  averageDelayMinutes = 0,
  delayCauses = DEFAULT_DELAY_CAUSES,
  delayHistogram = [],
}: NetworkStatusPanelProps) {
  // Local state for the expandable causes table
  const [showAllCauses, setShowAllCauses] = useState(false);

  const flightsTotalDisplay = useMemo(() => formatFlightCount(flightsTotal), [flightsTotal]);
  const flightsLandedDisplay = useMemo(() => formatFlightCount(flightsLanded), [flightsLanded]);
  const flightsAirborneDisplay = useMemo(() => formatFlightCount(flightsAirborne), [flightsAirborne]);
  const averageDelayDisplay = useMemo(
    () => formatAverageDelayMinutes(averageDelayMinutes),
    [averageDelayMinutes],
  );

  const displayedCauses = useMemo(() => {
    if (showAllCauses) return delayCauses;
    return delayCauses.slice(0, 5);
  }, [delayCauses, showAllCauses]);
  const hiddenCauseCount = Math.max(0, delayCauses.length - displayedCauses.length);

  return (
    <div
      className={
        embedded
          ? "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col"
          : "absolute top-20 left-4 z-50 min-w-[280px] max-w-[420px] rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col"
      }
    >
      {/* No internal scroll; outer wrapper should manage scrolling */}
      <div className="p-4 space-y-4">
        {/* Flights section */}
        <div className="bg-white/5 rounded-lg p-4">
          <h2 className="font-semibold mb-3">Flights</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MetricCard
              label="Total"
              value={flightsTotalDisplay}
              icon={
                <Plane width="14" height="14" strokeWidth="2" aria-hidden="true" />
              }
            />
            <MetricCard
              label="Landed"
              value={flightsLandedDisplay}
              icon={
                <PlaneLanding width="14" height="14" strokeWidth="2" aria-hidden="true" />
              }
            />
            <MetricCard
              label="Airborne"
              value={flightsAirborneDisplay}
              icon={
                <Plane width="14" height="14" strokeWidth="2" aria-hidden="true" />
              }
            />
          </div>
        </div>

        {/* Delays section */}
        <div className="bg-white/5 rounded-lg p-4">
          <h2 className="font-semibold mb-3">Delays</h2>

          {/* Charts first, full width stacked */}
          <div className="bg-white/0 rounded-lg p-2 mb-3">
            <h4 className="text-sm font-medium mb-2 opacity-90">Delay Histogram</h4>
            <div className="h-24">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={delayHistogram} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.15)" />
                  <XAxis dataKey="bucket" stroke="#fff" tick={{ fontSize: 11 }} />
                  <YAxis stroke="#fff" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "var(--menu-bg)", border: "1px solid var(--menu-border)", borderRadius: 8, color: "var(--menu-text)" }}
                    labelStyle={{ color: "var(--menu-text)" }}
                    itemStyle={{ color: "var(--menu-text)" }}
                  />
                  <Bar dataKey="count" name="Flights" fill="#60a5fa" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Average delay stacked with description */}
          <div className="mb-4">
            <MetricCard
              label="Avg Delay / Flight"
              value={averageDelayDisplay}
              accent="bg-amber-400/30"
              icon={
                <Clock3 width="16" height="16" strokeWidth="2" aria-hidden="true" />
              }
            />
            <div className="text-xs opacity-80 mt-2">
              Represents mean arrival delay across all flights in scope.
            </div>
          </div>

          {/* Causes table */}
          <div className="rounded-lg border border-white/10 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-white/10">
                  <th className="text-left p-2 font-semibold">Cause</th>
                  <th className="text-right p-2 font-semibold">Delay (min)</th>
                </tr>
              </thead>
              <tbody>
                {displayedCauses.map((row, idx) => (
                  <tr
                    key={`${row.cause}-${idx}`}
                    className={`border-t border-white/10 ${idx % 2 === 0 ? "bg-white/0" : "bg-white/5"}`}
                  >
                    <td className="p-2">{row.cause}</td>
                    <td className="p-2 text-right font-mono">{formatDelayCauseMinutes(row.delayMinutes)}</td>
                  </tr>
                ))}
                {delayCauses.length > 5 && !showAllCauses && (
                  <tr className="border-t border-white/10 hover:bg-white/10 cursor-pointer" onClick={() => setShowAllCauses(true)}>
                    <td className="p-2 text-center italic opacity-80" colSpan={2}>
                      {formatSeeMoreLabel(hiddenCauseCount)}
                    </td>
                  </tr>
                )}
                {delayCauses.length > 5 && showAllCauses && (
                  <tr className="border-t border-white/10 hover:bg-white/10 cursor-pointer" onClick={() => setShowAllCauses(false)}>
                    <td className="p-2 text-center italic opacity-80" colSpan={2}>
                      {SEE_LESS_LABEL}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, accent, icon }: { label: string; value: string | number; accent?: string; icon?: React.ReactNode }) {
  return (
    <div className={`rounded-xl border border-white/10 bg-white/10 px-2.5 py-2 flex items-center gap-2 ${accent ? accent : ""}`}>
      {icon && <div className="text-white/40 shrink-0">{icon}</div>}
      <div className="min-w-0 flex-1">
        <div className="text-[9px] opacity-80 uppercase tracking-wider truncate">{label}</div>
        <div className="text-sm font-semibold leading-tight mt-0.5 truncate">{value}</div>
      </div>
    </div>
  );
}

function formatDelayCauseMinutes(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? Number.NaN)) {
    return "—";
  }

  return Math.max(0, Math.round(Number(value))).toLocaleString();
}

function formatAverageDelayMinutes(value: number | null | undefined): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "0 min";
  }

  const rounded = Math.round(numeric * 10) / 10;
  return `${rounded.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
    maximumFractionDigits: 1,
  })} min`;
}

const compactNumberFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatFlightCount(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0";
  }

  const safeValue = Math.max(0, Math.round(value));
  if (safeValue === 0) {
    return "0";
  }

  if (safeValue >= 1000) {
    return compactNumberFormatter.format(safeValue).toLowerCase();
  }

  return safeValue.toLocaleString();
}
