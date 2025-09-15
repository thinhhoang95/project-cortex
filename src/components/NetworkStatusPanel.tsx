"use client";
import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
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
  flightsTotal = 1042,
  flightsLanded = 612,
  flightsAirborne = 430,
  averageDelayMinutes = 14,
  delayCauses = DEFAULT_DELAY_CAUSES,
  delayHistogram = DEFAULT_HISTOGRAM,
}: NetworkStatusPanelProps) {
  // Local state for the expandable causes table
  const [showAllCauses, setShowAllCauses] = useState(false);

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

  // Build pie chart slices to cover >= 90% as individual, rest as Others
  const pieSlices = useMemo(() => {
    const total = sortedCauses.reduce((acc, c) => acc + c.count, 0) || 1;
    let running = 0;
    const slices: { name: string; value: number }[] = [];
    for (const c of sortedCauses) {
      const next = running + c.count;
      const pct = next / total;
      if (pct <= 0.9) {
        slices.push({ name: c.cause, value: c.count });
        running = next;
      } else {
        break;
      }
    }
    const used = slices.reduce((acc, s) => acc + s.value, 0);
    const remaining = Math.max(0, total - used);
    if (remaining > 0) slices.push({ name: "Others", value: remaining });
    return slices;
  }, [sortedCauses]);

  const piePalette = [
    "#60a5fa",
    "#f59e0b",
    "#34d399",
    "#a78bfa",
    "#f472b6",
    "#f87171",
    "#22d3ee",
    "#eab308",
    "#4ade80",
    "#f97316",
    "#c084fc",
  ];

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
            <MetricCard label="Total" value={flightsTotal.toLocaleString()} />
            <MetricCard label="Landed" value={flightsLanded.toLocaleString()} />
            <MetricCard label="Airborne" value={flightsAirborne.toLocaleString()} />
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
                  <Tooltip contentStyle={{ background: "rgba(30,41,59,0.9)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8 }} />
                  <Bar dataKey="count" name="Flights" fill="#60a5fa" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white/0 rounded-lg p-2 mb-4">
            <h4 className="text-sm font-medium mb-2 opacity-90">Delay Causes (≥90%)</h4>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie dataKey="value" nameKey="name" data={pieSlices} innerRadius={40} outerRadius={70} paddingAngle={1}>
                    {pieSlices.map((entry, index) => (
                      <Cell key={`slice-${index}`} fill={piePalette[index % piePalette.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "rgba(30,41,59,0.9)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8 }} />
                </PieChart>
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
                      See more…
                    </td>
                  </tr>
                )}
                {sortedCauses.length > 5 && showAllCauses && (
                  <tr className="border-t border-white/10 hover:bg-white/10 cursor-pointer" onClick={() => setShowAllCauses(false)}>
                    <td className="p-2 text-center italic opacity-80" colSpan={2}>
                      See less…
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
