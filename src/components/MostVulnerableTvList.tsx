"use client";

import { useMemo, useRef, useState } from "react";
import TrafficVolumeMiniMap from "@/components/TrafficVolumeMiniMap";

export type MostVulnerableTvItem = {
  traffic_volume_id?: string | null;
  time_bin?: number | null;
  slack?: number | null;
  rolling_hour_occupancy?: number | null;
  capacity_per_bin?: number | null;
  demand15?: number | null;
  demand30?: number | null;
};

export type MostVulnerableTvListProps = {
  mvtv15?: MostVulnerableTvItem[] | null;
  mvtv30?: MostVulnerableTvItem[] | null;
  className?: string;
};

type ActiveSelection = { horizon: "15" | "30"; index: number };

function normalizeNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeItem(item: MostVulnerableTvItem | null | undefined): MostVulnerableTvItem | null {
  if (!item || typeof item !== "object") return null;
  const tvIdRaw = item.traffic_volume_id;
  const tvId = tvIdRaw == null ? "" : String(tvIdRaw).trim();
  return {
    traffic_volume_id: tvId || null,
    time_bin: normalizeNumber(item.time_bin),
    slack: normalizeNumber(item.slack),
    rolling_hour_occupancy: normalizeNumber(item.rolling_hour_occupancy),
    capacity_per_bin: normalizeNumber(item.capacity_per_bin),
    demand15: normalizeNumber(item.demand15),
    demand30: normalizeNumber(item.demand30),
  };
}

function normalizeItems(items?: MostVulnerableTvItem[] | null): MostVulnerableTvItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => normalizeItem(item))
    .filter((item): item is MostVulnerableTvItem => Boolean(item));
}

function formatMetric(value: number | null | undefined, digits = 2): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "–";
  return value.toFixed(digits);
}

function formatInteger(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "–";
  return String(Math.round(value));
}

function sectionTitle(horizon: "15" | "30"): string {
  return horizon === "15" ? "T+15" : "T+30";
}

export default function MostVulnerableTvList({
  mvtv15,
  mvtv30,
  className,
}: MostVulnerableTvListProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [activeSelection, setActiveSelection] = useState<ActiveSelection | null>(null);

  const items15 = useMemo(() => normalizeItems(mvtv15), [mvtv15]);
  const items30 = useMemo(() => normalizeItems(mvtv30), [mvtv30]);

  const hasItems = items15.length > 0 || items30.length > 0;

  const activeItem = useMemo(() => {
    if (!activeSelection) return null;
    const source = activeSelection.horizon === "15" ? items15 : items30;
    return source[activeSelection.index] || null;
  }, [activeSelection, items15, items30]);

  const rootClassName = ["space-y-2", className].filter(Boolean).join(" ");

  const renderSection = (horizon: "15" | "30", items: MostVulnerableTvItem[]) => {
    if (!items.length) return null;
    return (
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wide text-white/60">{sectionTitle(horizon)}</div>
        <div className="flex flex-wrap gap-1.5">
          {items.map((item, index) => {
            const tvId = item.traffic_volume_id || "Unknown";
            const isActive = activeSelection?.horizon === horizon && activeSelection?.index === index;
            return (
              <button
                key={`${horizon}-${tvId}-${index}`}
                type="button"
                onMouseEnter={() => setActiveSelection({ horizon, index })}
                onFocus={() => setActiveSelection({ horizon, index })}
                className={`rounded-md border px-2 py-1 text-[11px] font-mono transition-colors ${
                  isActive
                    ? "border-cyan-300/80 bg-cyan-500/20 text-cyan-100"
                    : "border-white/25 bg-white/10 text-white/85 hover:bg-white/15"
                }`}
                title={`Show ${tvId} details`}
              >
                {tvId}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      className={rootClassName}
      onMouseLeave={() => setActiveSelection(null)}
      onBlurCapture={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !rootRef.current?.contains(next)) {
          setActiveSelection(null);
        }
      }}
    >
      <div className="text-[11px] text-white/70">Most Vulnerable TVs</div>
      {!hasItems ? (
        <div className="text-[11px] text-white/55">No vulnerable TVs returned</div>
      ) : (
        <>
          {renderSection("15", items15)}
          {renderSection("30", items30)}
        </>
      )}

      {activeItem && activeSelection && (
        <div className="rounded-lg border border-white/15 bg-slate-950/80 p-2 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-mono text-white/90">
              {activeItem.traffic_volume_id || "Unknown TV"}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-cyan-200">
              {sectionTitle(activeSelection.horizon)}
            </span>
          </div>
          <div className="h-28 w-full overflow-hidden rounded-md border border-white/10 bg-slate-950/70">
            <TrafficVolumeMiniMap
              trafficVolumeId={activeItem.traffic_volume_id || undefined}
              className="h-full w-full"
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <div className="flex justify-between">
              <span className="text-white/60">Time Bin:</span>
              <span>{formatInteger(activeItem.time_bin)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Slack:</span>
              <span>{formatMetric(activeItem.slack)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Rolling Occ.:</span>
              <span>{formatMetric(activeItem.rolling_hour_occupancy)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Capacity/Bin:</span>
              <span>{formatMetric(activeItem.capacity_per_bin)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Demand15:</span>
              <span>{formatMetric(activeItem.demand15)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/60">Demand30:</span>
              <span>{formatMetric(activeItem.demand30)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
