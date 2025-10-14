"use client";
import { useMemo, useState } from "react";
import { formatSeeMoreLabel, SEE_LESS_LABEL } from "@/lib/seeMoreLess";
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";

type DelayCause = {
  cause: string;
  count: number; // number of occurrences or aggregated delay minutes
};

type HistogramBin = {
  bucket: string; // e.g., "0-15", "15-30"
  count: number; // frequency
};

type NetworkStatusPanelProps = {
  embedded?: boolean;
  flightsTotal?: number;
  flightsLanded?: number;
  flightsAirborne?: number;
  averageDelayMinutes?: number; // average delay per flight (minutes)
  delayCauses?: DelayCause[];
  delayHistogram?: HistogramBin[];
};

const DEFAULT_DELAY_CAUSES: DelayCause[] = [
  { cause: "Weather", count: 120 },
  { cause: "ATC Staffing", count: 95 },
  { cause: "Runway Congestion", count: 80 },
  { cause: "Aircraft Readiness", count: 65 },
  { cause: "Ground Operations", count: 48 },
  { cause: "Security", count: 35 },
  { cause: "Airspace Restrictions", count: 28 },
  { cause: "Late Inbound", count: 22 },
  { cause: "Crew", count: 17 },
  { cause: "Other", count: 11 },
];

const DEFAULT_HISTOGRAM: HistogramBin[] = [
  { bucket: "0-15", count: 210 },
  { bucket: "15-30", count: 130 },
  { bucket: "30-45", count: 70 },
  { bucket: "45-60", count: 38 },
  { bucket: "60-90", count: 20 },
  { bucket: ">=90", count: 9 },
];

export default function NetworkStatusPanel({
  embedded = true,
  flightsTotal = 0,
  flightsLanded = 0,
  flightsAirborne = 0,
  averageDelayMinutes = 14,
  delayCauses = DEFAULT_DELAY_CAUSES,
  delayHistogram = DEFAULT_HISTOGRAM,
}: NetworkStatusPanelProps) {
  // Local state for the expandable causes table
  const [showAllCauses, setShowAllCauses] = useState(false);

  const flightsTotalDisplay = useMemo(() => formatFlightCount(flightsTotal), [flightsTotal]);
  const flightsLandedDisplay = useMemo(() => formatFlightCount(flightsLanded), [flightsLanded]);
  const flightsAirborneDisplay = useMemo(() => formatFlightCount(flightsAirborne), [flightsAirborne]);

  // Sort causes by count desc for table and pie accumulation
  const sortedCauses = useMemo(() => {
    const copy = [...delayCauses];
    copy.sort((a, b) => b.count - a.count);
    return copy;
  }, [delayCauses]);

  const displayedCauses = useMemo(() => {
    if (showAllCauses) return sortedCauses;
    return sortedCauses.slice(0, 5);
  }, [sortedCauses, showAllCauses]);
  const hiddenCauseCount = Math.max(0, sortedCauses.length - displayedCauses.length);

  

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
            <MetricCard label="Total" value={flightsTotalDisplay} />
            <MetricCard label="Landed" value={flightsLandedDisplay} />
            <MetricCard label="Airborne" value={flightsAirborneDisplay} />
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
            <MetricCard label="Avg Delay / Flight" value={`${averageDelayMinutes} mins`} accent="bg-amber-400/30" />
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
                  <th className="text-right p-2 font-semibold">Count</th>
                </tr>
              </thead>
              <tbody>
                {displayedCauses.map((row, idx) => (
                  <tr
                    key={`${row.cause}-${idx}`}
                    className={`border-t border-white/10 ${idx % 2 === 0 ? "bg-white/0" : "bg-white/5"}`}
                  >
                    <td className="p-2">{row.cause}</td>
                    <td className="p-2 text-right font-mono">{row.count.toLocaleString()}</td>
                  </tr>
                ))}
                {sortedCauses.length > 5 && !showAllCauses && (
                  <tr className="border-t border-white/10 hover:bg-white/10 cursor-pointer" onClick={() => setShowAllCauses(true)}>
                    <td className="p-2 text-center italic opacity-80" colSpan={2}>
                      {formatSeeMoreLabel(hiddenCauseCount)}
                    </td>
                  </tr>
                )}
                {sortedCauses.length > 5 && showAllCauses && (
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

function MetricCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className={`rounded-xl border border-white/10 bg-white/10 p-3 flex flex-col ${accent ? accent : ""}`}>
      <div className="text-xs opacity-80">{label}</div>
      <div className="text-xl font-semibold leading-tight">{value}</div>
    </div>
  );
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
