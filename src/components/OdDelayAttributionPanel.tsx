"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SaOdAttributedDelay } from "@/lib/agentSaTypes";
import ShimmeringText from "@/components/ShimmeringText";

const INITIAL_VISIBLE_ROWS = 15;

function formatAdaptive(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return "—";
  const isInt = Math.abs(value - Math.round(value)) < 1e-6;
  const digits = isInt ? 0 : fractionDigits;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatCount(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return Math.round(numeric).toLocaleString();
}

interface OdDelayAttributionPanelProps {
  odAttributedDelay: SaOdAttributedDelay | null | undefined;
  loading?: boolean;
  error?: string | null;
  title?: string;
}

export default function OdDelayAttributionPanel({
  odAttributedDelay,
  loading = false,
  error = null,
  title = "OD Pair Delay Attribution",
}: OdDelayAttributionPanelProps) {
  const [visibleRows, setVisibleRows] = useState(INITIAL_VISIBLE_ROWS);

  const chartData = useMemo(() => {
    const pairs = Array.isArray(odAttributedDelay?.pairs) ? odAttributedDelay.pairs : [];
    return pairs
      .map((pair) => ({
        odPair: pair.od_pair,
        delayMinutes: Number(pair.delay_minutes),
        delayedFlights: Number(pair.num_delayed_flights),
      }))
      .filter(
        (pair) =>
          pair.odPair &&
          Number.isFinite(pair.delayMinutes) &&
          Number.isFinite(pair.delayedFlights),
      )
      .sort(
        (a, b) => b.delayMinutes - a.delayMinutes || a.odPair.localeCompare(b.odPair),
      );
  }, [odAttributedDelay]);

  useEffect(() => {
    setVisibleRows(INITIAL_VISIBLE_ROWS);
  }, [odAttributedDelay]);

  const displayedRows = useMemo(
    () => chartData.slice(0, visibleRows),
    [chartData, visibleRows],
  );

  const metadata = odAttributedDelay?.metadata;
  const hasMoreRows = chartData.length > visibleRows;
  const canCollapse = chartData.length > INITIAL_VISIBLE_ROWS && visibleRows > INITIAL_VISIBLE_ROWS;
  const chartInnerHeight = Math.max(180, displayedRows.length * 32 + 24);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-wider text-white/60">{title}</div>
        <div className="text-[11px] text-white/55">
          {chartData.length > 0
            ? `${chartData.length} OD pair${chartData.length === 1 ? "" : "s"}`
            : "No OD pairs"}
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Total Delay</div>
          <div className="text-lg font-semibold text-white">
            {formatAdaptive(Number(metadata?.total_delay_minutes), 2)} min
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Attributed Delay</div>
          <div className="text-lg font-semibold text-white">
            {formatAdaptive(Number(metadata?.attributed_delay_minutes), 2)} min
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Attributed Flights</div>
          <div className="text-lg font-semibold text-white">
            {formatCount(metadata?.num_attributed_delayed_flights)}
          </div>
          <div className="text-[12px] text-white/60 mt-1">
            {formatCount(metadata?.num_unattributed_delayed_flights)} unattributed
          </div>
        </div>
      </div>

      {loading && chartData.length === 0 ? (
        <div className="flex h-[180px] items-center justify-center rounded-lg border border-white/10 bg-white/5 text-sm text-white/70">
          <ShimmeringText text="Loading OD attribution..." />
        </div>
      ) : chartData.length > 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <div style={{ height: chartInnerHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={displayedRows}
                layout="vertical"
                margin={{ top: 8, right: 20, left: 8, bottom: 8 }}
              >
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
                  dataKey="odPair"
                  width={88}
                  tick={{ fontSize: 11, fill: "#e2e8f0" }}
                  axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value: number, name: string, context: any) => {
                    if (name === "delayMinutes") {
                      return [`${formatAdaptive(Number(value), 2)} min`, "Delay minutes"];
                    }
                    return [String(value), name];
                  }}
                  labelFormatter={(_, payload) => {
                    const entry = payload?.[0]?.payload;
                    if (!entry) return "";
                    return `${entry.odPair} · ${formatCount(entry.delayedFlights)} flights`;
                  }}
                  contentStyle={{
                    background: "rgba(15,23,42,0.95)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 8,
                    color: "white",
                  }}
                  itemStyle={{ color: "white" }}
                  labelStyle={{ color: "white" }}
                />
                <Bar
                  dataKey="delayMinutes"
                  name="delayMinutes"
                  fill="#60a5fa"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {(hasMoreRows || canCollapse) && (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() =>
                  setVisibleRows((current) =>
                    hasMoreRows ? current + INITIAL_VISIBLE_ROWS : INITIAL_VISIBLE_ROWS,
                  )
                }
                className="rounded-md border border-white/15 bg-white/10 px-3 py-1.5 text-xs text-white/75 transition hover:bg-white/15"
              >
                {hasMoreRows ? "Show more" : "Show less"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/70">
          No OD delay attribution to visualize.
        </div>
      )}
    </div>
  );
}
