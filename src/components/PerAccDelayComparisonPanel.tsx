"use client";

import { useMemo } from "react";
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
import type { RegulationPlanPerAccAttribMode } from "@/lib/models";
import { PER_ACC_ATTRIB_MODE_OPTIONS } from "@/lib/perAccAttribution";
import type { StoredPerAccAttribByMode } from "@/lib/perAccComparison";

type ComparisonSnapshot = {
  id: string;
  description: string;
  perAccAttribByMode?: StoredPerAccAttribByMode | null;
};

type AccChartRow = {
  acc: string;
  combinedDelay: number;
} & Record<string, number | string>;

interface PerAccDelayComparisonPanelProps {
  snapshots: ComparisonSnapshot[];
  colorBySnapshotId: Map<string, string>;
  mode: RegulationPlanPerAccAttribMode;
  onModeChange: (mode: RegulationPlanPerAccAttribMode) => void;
}

type SnapshotAttribEntry = {
  snapshot: ComparisonSnapshot;
  attrib: NonNullable<StoredPerAccAttribByMode[RegulationPlanPerAccAttribMode]>;
};

function formatAdaptive(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return "—";
  const isInt = Math.abs(value - Math.round(value)) < 1e-6;
  const digits = isInt ? 0 : fractionDigits;
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatFlights(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return "—";
  return Math.round(Number(value)).toLocaleString();
}

function formatSecondsToHMM(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return "—";
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function toFiniteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export default function PerAccDelayComparisonPanel({
  snapshots,
  colorBySnapshotId,
  mode,
  onModeChange,
}: PerAccDelayComparisonPanelProps) {
  const snapshotsWithAttrib = useMemo<SnapshotAttribEntry[]>(() => {
    const entries: SnapshotAttribEntry[] = [];
    snapshots.forEach((snapshot) => {
      const attrib = snapshot.perAccAttribByMode?.[mode];
      if (attrib) {
        entries.push({ snapshot, attrib });
      }
    });
    return entries;
  }, [mode, snapshots]);

  const missingSnapshots = useMemo(
    () => snapshots.filter((snapshot) => !snapshot.perAccAttribByMode?.[mode]),
    [mode, snapshots],
  );

  const chartData = useMemo<AccChartRow[]>(() => {
    const totals = new Map<string, AccChartRow>();
    snapshotsWithAttrib.forEach(({ snapshot, attrib }) => {
      Object.entries(attrib.delay_minutes_by_acc || {}).forEach(([acc, rawValue]) => {
        const value = Number(rawValue);
        if (!Number.isFinite(value)) return;
        const key = String(acc || "UNK");
        let row = totals.get(key);
        if (!row) {
          row = { acc: key, combinedDelay: 0 };
          totals.set(key, row);
        }
        row.combinedDelay += value;
        row[snapshot.id] = value;
      });
    });

    return Array.from(totals.values())
      .sort((a, b) => b.combinedDelay - a.combinedDelay || String(a.acc).localeCompare(String(b.acc)))
      .slice(0, 12);
  }, [snapshotsWithAttrib]);

  const chartInnerHeight = Math.max(220, chartData.length * 40 + 24);
  const chartViewportHeight = Math.min(520, chartInnerHeight);
  const chartScrollable = chartInnerHeight > chartViewportHeight;
  const modeLabel =
    PER_ACC_ATTRIB_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-white/60">ACC delay comparison</div>
          <div className="text-sm text-white/70">{modeLabel}</div>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-white/60">
          <select
            aria-label="Select ACC delay attribution mode"
            className="h-8 px-3 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15 transition-colors text-[12px]"
            value={mode}
            onChange={(event) => onModeChange(event.currentTarget.value as RegulationPlanPerAccAttribMode)}
          >
            {PER_ACC_ATTRIB_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div>
            {chartData.length > 0
              ? `Top ${chartData.length} ACC${chartData.length === 1 ? "" : "s"} by attributed delay`
              : "No ACC attribution to compare"}
          </div>
        </div>
      </div>

      {missingSnapshots.length > 0 && (
        <div className="text-[12px] text-amber-200">
          {missingSnapshots.length === 1
            ? `Snapshot ${missingSnapshots[0].description || "Untitled"} is missing ${modeLabel.toLowerCase()} ACC attribution.`
            : `Snapshots ${missingSnapshots.map((snap) => snap.description || "Untitled").join(", ")} are missing ${modeLabel.toLowerCase()} ACC attribution.`}
        </div>
      )}

      {snapshotsWithAttrib.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-lg p-4 text-sm text-white/70">
          No saved ACC attribution is available for this mode.
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {snapshotsWithAttrib.map(({ snapshot, attrib }) => {
              const meta = attrib.metadata;
              const totalDelay = toFiniteNumber(meta?.total_delay_minutes);
              const attributedDelay = toFiniteNumber(meta?.attributed_delay_minutes);
              const delayedFlights = toFiniteNumber(meta?.num_delayed_flights);
              const accBuckets = Object.keys(attrib.delay_minutes_by_acc || {}).length;
              const dwellPolicy = typeof meta?.dwell_policy === "string" ? meta.dwell_policy : null;
              const color = colorBySnapshotId.get(snapshot.id) || "#fff";
              return (
                <div key={snapshot.id} className="bg-white/5 border border-white/10 rounded-lg p-4 text-white/80 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className="inline-flex w-2 h-2 rounded-full" style={{ background: color }} />
                    <span>{snapshot.description || "Untitled"}</span>
                  </div>
                  <div className="text-[11px] uppercase tracking-wider text-white/60">Attributed delay</div>
                  <div className="text-2xl font-semibold text-white">
                    {attributedDelay !== null ? `${formatAdaptive(attributedDelay, 1)} min` : "—"}
                  </div>
                  <div className="text-[12px] text-white/60">
                    Total {totalDelay !== null ? `${formatAdaptive(totalDelay, 1)} min` : "—"}
                    {totalDelay !== null ? ` • ${formatSecondsToHMM(totalDelay * 60)}` : ""}
                  </div>
                  <div className="text-[12px] text-white/60">
                    Delayed flights {formatFlights(delayedFlights)} • ACC buckets {accBuckets.toLocaleString()}
                  </div>
                  {dwellPolicy && <div className="text-[12px] text-white/60">{dwellPolicy}</div>}
                </div>
              );
            })}
          </div>

          {chartData.length > 0 && (
            <div className="bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="text-[11px] uppercase tracking-wider text-white/60 mb-3">Delay minutes by ACC</div>
              <div
                className={chartScrollable ? "overflow-y-auto pr-1" : undefined}
                style={chartScrollable ? { maxHeight: chartViewportHeight } : undefined}
              >
                <div style={{ height: chartInnerHeight }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 11, fill: "#e2e8f0" }}
                        tickFormatter={(value: number) => formatAdaptive(Number(value), 1)}
                        axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                        tickLine={false}
                        allowDecimals
                      />
                      <YAxis
                        type="category"
                        dataKey="acc"
                        width={72}
                        tick={{ fontSize: 11, fill: "#e2e8f0" }}
                        axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                        tickLine={false}
                      />
                      <Tooltip
                        formatter={(value: number, name: string) => [
                          `${formatAdaptive(Number(value), 2)} min`,
                          snapshots.find((snapshot) => snapshot.id === name)?.description || name,
                        ]}
                        labelFormatter={(label) => `ACC ${label}`}
                        contentStyle={{
                          background: "rgba(15,23,42,0.95)",
                          border: "1px solid rgba(255,255,255,0.15)",
                          borderRadius: 8,
                          color: "white",
                        }}
                        itemStyle={{ color: "white" }}
                        labelStyle={{ color: "white" }}
                      />
                      <Legend
                        wrapperStyle={{ color: "#f8fafc" }}
                        formatter={(value) =>
                          snapshots.find((snapshot) => snapshot.id === value)?.description || String(value)
                        }
                      />
                      {snapshotsWithAttrib.map(({ snapshot }) => (
                        <Bar
                          key={snapshot.id}
                          dataKey={snapshot.id}
                          name={snapshot.id}
                          fill={colorBySnapshotId.get(snapshot.id) || "#38bdf8"}
                          radius={[0, 4, 4, 0]}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
