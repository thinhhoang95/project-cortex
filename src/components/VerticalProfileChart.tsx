"use client";
import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import type { Trajectory } from "@/lib/models";

export interface VerticalProfileChartProps {
  flight: Trajectory;
  // Absolute seconds since midnight for current sim time; optional
  currentTime?: number;
  // Fixed pixel height of the chart; width is responsive
  height?: number;
  // Optional class for outer container
  className?: string;
}

type Datum = { tRel: number; fl: number };

function formatHm(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}`;
  return `${m}m`;
}

function toFL(altFt: number | undefined): number {
  if (typeof altFt !== "number" || !isFinite(altFt)) return 0;
  return Math.round(altFt / 100);
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  const fl: number = p?.value ?? 0;
  return (
    <div className="rounded-md border border-white/20 bg-slate-900/80 text-white px-2 py-1 text-xs shadow">
      <div>
        <span className="opacity-70">T+ </span>
        <span className="font-semibold">{formatHm(Number(label) || 0)}</span>
      </div>
      <div>
        <span className="opacity-70">Altitude: </span>
        <span className="font-semibold">FL{fl.toString().padStart(3, "0")}</span>
      </div>
    </div>
  );
};

export default function VerticalProfileChart({
  flight,
  currentTime,
  height = 140,
  className,
}: VerticalProfileChartProps) {
  const duration = Math.max(0, (flight?.t1 || 0) - (flight?.t0 || 0));

  const data: Datum[] = useMemo(() => {
    if (!flight || !flight.times || !flight.coords) return [];
    const res: Datum[] = [];
    for (let i = 0; i < Math.min(flight.times.length, flight.coords.length); i++) {
      const tAbs = flight.times[i];
      const tRel = Math.max(0, tAbs - flight.t0);
      const altFt = flight.coords[i]?.[2];
      res.push({ tRel, fl: toFL(altFt) });
    }
    // Ensure start and end exist
    if (res.length > 0) {
      if (res[0].tRel !== 0) res.unshift({ tRel: 0, fl: res[0].fl });
      if (duration > 0 && res[res.length - 1].tRel !== duration) {
        res.push({ tRel: duration, fl: res[res.length - 1].fl });
      }
    }
    return res;
  }, [flight, duration]);

  const yMax = useMemo(() => {
    const max = data.reduce((m, d) => Math.max(m, d.fl), 0);
    // Round up to the nearest 10 FL for nicer ticks
    return Math.ceil(max / 10) * 10 || 10;
  }, [data]);

  const nowRel = typeof currentTime === "number" ? currentTime - flight.t0 : undefined;
  const showNow = typeof nowRel === "number" && nowRel >= 0 && nowRel <= duration;

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 6, left: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.12)" strokeDasharray="3 3" />
          <XAxis
            dataKey="tRel"
            type="number"
            domain={[0, Math.max(1, duration)]}
            tickFormatter={formatHm}
            stroke="#cbd5e1"
            tick={{ fontSize: 11 }}
          />
          <YAxis
            dataKey="fl"
            domain={[0, yMax]}
            allowDecimals={false}
            tickFormatter={(v) => `FL${Number(v).toFixed(0)}`}
            stroke="#cbd5e1"
            width={48}
            tick={{ fontSize: 11 }}
          />
          <Tooltip content={<CustomTooltip />} />
          {showNow && (
            <ReferenceLine x={nowRel} stroke="#fbbf24" strokeWidth={2} strokeDasharray="4 3" />
          )}
          <Line
            type="monotone"
            dataKey="fl"
            stroke="#60a5fa"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

