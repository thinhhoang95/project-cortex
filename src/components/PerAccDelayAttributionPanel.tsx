"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Bar,
} from "recharts";
import ShimmeringText from "@/components/ShimmeringText";
import type { RegulationPlanPerAccAttrib, RegulationPlanPerAccAttribMode } from "@/lib/models";
import { normalizePerAccAttribMode, PER_ACC_ATTRIB_MODE_OPTIONS } from "@/lib/perAccAttribution";

type AccDelayAttribChartRow = {
  acc: string;
  delayMinutes: number;
};

interface PerAccDelayAttributionPanelProps {
  perAccAttrib: RegulationPlanPerAccAttrib | null | undefined;
  mode: RegulationPlanPerAccAttribMode;
  loading?: boolean;
  error?: string | null;
  onModeChange: (mode: RegulationPlanPerAccAttribMode) => void | Promise<void>;
  unavailableMessage?: string;
  title?: string;
  variant?: "dialog" | "page";
}

const toTrimmedString = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  try {
    return String(value).trim();
  } catch {
    return "";
  }
};

const stringWithFallback = (value: unknown, fallback: string): string => {
  const trimmed = toTrimmedString(value);
  return trimmed.length > 0 ? trimmed : fallback;
};

const toFiniteNumber = (value: unknown): number | null => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const formatAdaptive = (value: number, fractionDigits = 1) => {
  if (!Number.isFinite(value)) return "—";
  const isInt = Math.abs(value - Math.round(value)) < 1e-6;
  const digits = isInt ? 0 : fractionDigits;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

const formatFlights = (value: number) => (Number.isFinite(value) ? Math.round(value).toLocaleString() : "0");

const formatSecondsToHMM = (totalSeconds: number): string => {
  if (!Number.isFinite(totalSeconds)) return "—";
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

export default function PerAccDelayAttributionPanel({
  perAccAttrib,
  mode,
  loading = false,
  error = null,
  onModeChange,
  unavailableMessage = "ACC attribution is unavailable for the current response.",
  title = "ACC Delay Attribution",
  variant = "dialog",
}: PerAccDelayAttributionPanelProps) {
  const topHeadingClass =
    variant === "dialog"
      ? "text-sm uppercase tracking-wider text-gray-300"
      : "text-[11px] uppercase tracking-wider text-white/60";
  const panelRadiusClass = variant === "dialog" ? "rounded-xl" : "rounded-lg";

  const resultMode = normalizePerAccAttribMode(perAccAttrib?.mode);
  const resultModeLabel =
    PER_ACC_ATTRIB_MODE_OPTIONS.find((option) => option.value === resultMode)?.label ?? resultMode;

  const chartData = useMemo<AccDelayAttribChartRow[]>(() => {
    const byAcc = perAccAttrib?.delay_minutes_by_acc;
    if (!byAcc || typeof byAcc !== "object") return [];
    return Object.entries(byAcc)
      .map(([accRaw, delayRaw]) => {
        const delayMinutes = Number(delayRaw);
        if (!Number.isFinite(delayMinutes)) return null;
        return {
          acc: stringWithFallback(accRaw, "UNK"),
          delayMinutes,
        };
      })
      .filter((row): row is AccDelayAttribChartRow => !!row)
      .sort((a, b) => b.delayMinutes - a.delayMinutes || a.acc.localeCompare(b.acc));
  }, [perAccAttrib]);

  const chartInnerHeight = Math.max(180, chartData.length * 32 + 24);
  const chartViewportHeight = Math.min(420, chartInnerHeight);
  const chartScrollable = chartInnerHeight > chartViewportHeight;

  const meta = perAccAttrib?.metadata;
  const totalDelayMinutes = toFiniteNumber(meta?.total_delay_minutes);
  const attributedDelayMinutes = toFiniteNumber(meta?.attributed_delay_minutes);
  const unattributedDelayMinutes = toFiniteNumber(meta?.unattributed_delay_minutes);
  const delayedFlights = toFiniteNumber(meta?.num_delayed_flights);
  const attributedDelayedFlights = toFiniteNumber(meta?.num_attributed_delayed_flights);
  const dwellPolicy = toTrimmedString(meta?.dwell_policy);
  const hasUnattributedDelay = (unattributedDelayMinutes ?? 0) > 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className={topHeadingClass}>{title}</div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="text-[11px] uppercase tracking-wider text-white/60">Mode</div>
          <select
            aria-label="Select per-ACC delay attribution mode"
            className="h-8 px-3 rounded-md bg-white/10 border border-white/20 text-white/80 hover:bg-white/15 transition-colors text-[12px] disabled:opacity-60"
            value={mode}
            onChange={(event) => void onModeChange(event.currentTarget.value as RegulationPlanPerAccAttribMode)}
            disabled={loading}
          >
            {PER_ACC_ATTRIB_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {loading && (
            <div className="text-[11px] text-white/70">
              <ShimmeringText text="Refreshing attribution..." />
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {error}
        </div>
      )}

      {perAccAttrib ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className={`bg-white/5 border border-white/10 ${panelRadiusClass} p-4`}>
              <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Mode</div>
              <div className="text-lg font-semibold text-white">{resultModeLabel}</div>
              {dwellPolicy && <div className="text-[12px] text-white/60 mt-1">{dwellPolicy}</div>}
            </div>
            <div className={`bg-white/5 border border-white/10 ${panelRadiusClass} p-4`}>
              <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Total Delay</div>
              <div className="text-lg font-semibold text-white">
                {totalDelayMinutes !== null ? `${formatAdaptive(totalDelayMinutes, 2)} min` : "—"}
              </div>
              {totalDelayMinutes !== null && (
                <div className="text-[12px] text-white/60 mt-1">{formatSecondsToHMM(totalDelayMinutes * 60)}</div>
              )}
            </div>
            <div className={`bg-white/5 border border-white/10 ${panelRadiusClass} p-4`}>
              <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Attributed Delay</div>
              <div className="text-lg font-semibold text-white">
                {attributedDelayMinutes !== null ? `${formatAdaptive(attributedDelayMinutes, 2)} min` : "—"}
              </div>
              {attributedDelayMinutes !== null && (
                <div className="text-[12px] text-white/60 mt-1">{formatSecondsToHMM(attributedDelayMinutes * 60)}</div>
              )}
            </div>
            <div
              className={`${panelRadiusClass} p-4 border ${
                hasUnattributedDelay ? "bg-rose-500/10 border-rose-400/40" : "bg-white/5 border-white/10"
              }`}
            >
              <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Unattributed Delay</div>
              <div className={`text-lg font-semibold ${hasUnattributedDelay ? "text-rose-200" : "text-white"}`}>
                {unattributedDelayMinutes !== null ? `${formatAdaptive(unattributedDelayMinutes, 2)} min` : "—"}
              </div>
              {unattributedDelayMinutes !== null && (
                <div className="text-[12px] text-white/60 mt-1">{formatSecondsToHMM(unattributedDelayMinutes * 60)}</div>
              )}
            </div>
            <div className={`bg-white/5 border border-white/10 ${panelRadiusClass} p-4`}>
              <div className="text-[11px] uppercase tracking-wider text-white/60 mb-1">Delayed Flights</div>
              <div className="text-lg font-semibold text-white">
                {delayedFlights !== null ? formatFlights(delayedFlights) : "—"}
              </div>
              {delayedFlights !== null && attributedDelayedFlights !== null && (
                <div className="text-[12px] text-white/60 mt-1">
                  {formatFlights(attributedDelayedFlights)} attributed
                </div>
              )}
            </div>
          </div>

          <div className={`bg-white/5 border border-white/10 ${panelRadiusClass} p-4`}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="text-[11px] uppercase tracking-wider text-white/60">Delay minutes by ACC</div>
              <div className="text-[11px] text-white/60">
                {chartData.length > 0
                  ? `${chartData.length} ACC${chartData.length === 1 ? "" : "s"}`
                  : "No ACC buckets"}
              </div>
            </div>

            {chartData.length > 0 ? (
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
                        width={64}
                        tick={{ fontSize: 11, fill: "#e2e8f0" }}
                        axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                        tickLine={false}
                      />
                      <Tooltip
                        formatter={(value: number) => [`${formatAdaptive(Number(value), 2)} min`, "Delay minutes"]}
                        contentStyle={{
                          background: "rgba(15,23,42,0.95)",
                          border: "1px solid rgba(255,255,255,0.15)",
                          borderRadius: 8,
                          color: "white",
                        }}
                        itemStyle={{ color: "white" }}
                        labelStyle={{ color: "white" }}
                      />
                      <Bar dataKey="delayMinutes" name="Delay minutes" fill="#34d399" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div className="text-sm text-white/70">No ACC delay attribution to visualize.</div>
            )}
          </div>
        </div>
      ) : (
        <div className={`bg-white/5 border border-white/10 ${panelRadiusClass} p-4 text-sm text-white/70`}>
          {unavailableMessage}
        </div>
      )}
    </div>
  );
}

