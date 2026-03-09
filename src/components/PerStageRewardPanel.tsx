"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ShimmeringText from "@/components/ShimmeringText";

export interface PerStageRewardEntry {
  step_number?: unknown;
  control_volume?: unknown;
  time_window?: unknown;
  proposal_rank?: unknown;
  reward?: unknown;
  [key: string]: unknown;
}

export interface PerStageRewardChartRow {
  step: number;
  reward: number;
  controlVolume: string | null;
  timeWindow: string | null;
  proposalRank: number | null;
  isSelected: boolean;
}

interface PerStageRewardPanelProps {
  rewards: PerStageRewardEntry[] | null | undefined;
  selectedStepNumber?: number | null;
  loading?: boolean;
  error?: string | null;
  truncated?: boolean;
  title?: string;
  unavailableMessage?: string;
}

const toOptionalString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toOptionalNumber = (value: unknown): number | null => {
  const num =
    typeof value === "string"
      ? Number.parseFloat(value)
      : typeof value === "number"
        ? value
        : null;
  return num !== null && Number.isFinite(num) ? num : null;
};

const formatReward = (value: number): string => {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 100) return Math.round(value).toString();
  const rounded = Number(value.toFixed(2));
  return rounded.toString();
};

export function normalizePerStageRewardRows(
  rewards: PerStageRewardEntry[] | null | undefined,
  selectedStepNumber?: number | null,
): PerStageRewardChartRow[] {
  if (!Array.isArray(rewards)) return [];

  return rewards
    .map((entry) => {
      const step = toOptionalNumber(entry?.step_number);
      const reward = toOptionalNumber(entry?.reward);
      if (step === null || reward === null) return null;
      const normalizedStep = Math.trunc(step);
      if (!Number.isFinite(normalizedStep) || normalizedStep < 1) return null;
      return {
        step: normalizedStep,
        reward,
        controlVolume: toOptionalString(entry?.control_volume),
        timeWindow: toOptionalString(entry?.time_window),
        proposalRank: toOptionalNumber(entry?.proposal_rank),
        isSelected: normalizedStep === selectedStepNumber,
      };
    })
    .filter((entry): entry is PerStageRewardChartRow => entry !== null)
    .sort((a, b) => a.step - b.step);
}

function RewardTooltip(props: {
  active?: boolean;
  payload?: Array<{ payload?: PerStageRewardChartRow; value?: number }>;
}) {
  const row = props.payload?.[0]?.payload;
  if (!props.active || !row) return null;

  return (
    <div className="rounded-lg border border-white/15 bg-slate-950/95 px-3 py-2 text-xs text-white shadow-xl">
      <div className="font-semibold text-white/90">Step {row.step}</div>
      <div className="mt-1 text-white/75">Reward: {formatReward(row.reward)}</div>
      {row.controlVolume ? (
        <div className="text-white/70">Control volume: {row.controlVolume}</div>
      ) : null}
      {row.timeWindow ? (
        <div className="text-white/70">Time window: {row.timeWindow}</div>
      ) : null}
      {row.proposalRank !== null ? (
        <div className="text-white/70">Proposal #{Math.trunc(row.proposalRank)}</div>
      ) : null}
    </div>
  );
}

export default function PerStageRewardPanel({
  rewards,
  selectedStepNumber = null,
  loading = false,
  error = null,
  truncated = false,
  title = "Per-Stage Reward",
  unavailableMessage = "Per-stage reward is unavailable for this step detail response.",
}: PerStageRewardPanelProps) {
  const chartData = useMemo(
    () => normalizePerStageRewardRows(rewards, selectedStepNumber),
    [rewards, selectedStepNumber],
  );

  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-white/85">{title}</h4>
          <p className="text-xs text-white/55">
            Visualize how each regulation step contributes to the selected trajectory.
          </p>
        </div>
        <div className="text-right text-[11px] uppercase tracking-wide text-white/45">
          <div>
            {chartData.length} stage{chartData.length === 1 ? "" : "s"}
          </div>
          {selectedStepNumber !== null && Number.isFinite(selectedStepNumber) ? (
            <div>Selected step {selectedStepNumber}</div>
          ) : null}
        </div>
      </div>

      {truncated ? (
        <div className="mt-3 rounded-lg border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          Stage rewards were truncated to match the available trajectory length.
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {error}
        </div>
      ) : null}

      {loading && chartData.length === 0 ? (
        <div className="mt-4 flex h-[220px] items-center justify-center">
          <ShimmeringText text="Loading stage rewards..." className="text-sm text-white/60 font-normal" />
        </div>
      ) : chartData.length > 0 ? (
        <div className="mt-4 h-[260px]" data-testid="per-stage-reward-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis
                dataKey="step"
                tick={{ fontSize: 11, fill: "#e2e8f0" }}
                axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#e2e8f0" }}
                tickFormatter={(value: number) => formatReward(Number(value))}
                axisLine={{ stroke: "rgba(255,255,255,0.2)" }}
                tickLine={false}
              />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.22)" />
              <Tooltip content={<RewardTooltip />} />
              <Bar dataKey="reward" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {chartData.map((entry) => (
                  <Cell
                    key={`reward-cell-${entry.step}`}
                    fill={entry.isSelected ? "#34d399" : "#38bdf8"}
                    fillOpacity={entry.isSelected ? 1 : 0.65}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-white/10 bg-white/5 px-3 py-4 text-sm text-white/70">
          {unavailableMessage}
        </div>
      )}
    </div>
  );
}
