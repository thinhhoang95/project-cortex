"use client";

import { memo, useMemo, useState } from "react";

import TrafficVolumeInfoTooltip from "@/components/TrafficVolumeInfoTooltip";
import {
  buildHotspotDiffCategories,
  type HotspotDiffCategoryEntry,
  type HotspotDiffCategoryKey,
} from "@/lib/hotspotDiffs";
import type { WithHotspotDiffs } from "@/lib/models";

const DEFAULT_VISIBLE_COUNT = 5;

type HotspotDiffSummaryCardProps = {
  hotspotDiffs?: Partial<WithHotspotDiffs> | null;
  tvOrder?: string[] | null;
  binMinutes: number;
  viewFrom: string;
  viewTo: string;
  onRevealTv?: (tvId: string) => void;
};

type CategoryConfig = {
  key: HotspotDiffCategoryKey;
  title: string;
  description: string;
  panelClassName: string;
  badgeClassName: string;
  emptyLabel: string;
};

const CATEGORY_CONFIG: CategoryConfig[] = [
  {
    key: "new",
    title: "New hotspots",
    description: "Overload windows introduced in the visible range.",
    panelClassName: "border-rose-300/20 bg-rose-500/10",
    badgeClassName: "border-rose-300/30 bg-rose-500/15 text-rose-100",
    emptyLabel: "No new hotspots in this window.",
  },
  {
    key: "extinguished",
    title: "Extinguished hotspots",
    description: "Hotspot windows that disappear in the visible range.",
    panelClassName: "border-emerald-300/20 bg-emerald-500/10",
    badgeClassName: "border-emerald-300/30 bg-emerald-500/15 text-emerald-100",
    emptyLabel: "No relieved hotspots in this window.",
  },
  {
    key: "changed",
    title: "Changed hotspot patterns",
    description: "TVs that both gain and relieve hotspot bins here. This is inferred.",
    panelClassName: "border-sky-300/20 bg-sky-500/10",
    badgeClassName: "border-sky-300/30 bg-sky-500/15 text-sky-100",
    emptyLabel: "No shifted hotspot patterns in this window.",
  },
];

function formatSeeMoreTvLabel(hiddenCount: number): string {
  const remaining = Math.max(0, hiddenCount);
  if (remaining <= 0) return "See more";
  return remaining === 1 ? "See 1 more TV" : `See ${remaining} more TVs`;
}

function formatBinPill(value: number, variant: "new" | "extinguished"): string {
  const abs = Math.max(0, Math.trunc(value));
  const prefix = variant === "new" ? "+" : "-";
  const noun = abs === 1 ? "bin" : "bins";
  return `${prefix}${abs} ${noun}`;
}

function formatSegmentPill(value: number): string {
  const abs = Math.max(0, Math.trunc(value));
  return abs === 1 ? "1 seg" : `${abs} segs`;
}

function HotspotSummaryRow({
  category,
  entry,
  onRevealTv,
}: {
  category: HotspotDiffCategoryKey;
  entry: HotspotDiffCategoryEntry;
  onRevealTv?: (tvId: string) => void;
}) {
  const content = (
    <>
      <div className="min-w-0">
        <TrafficVolumeInfoTooltip
          trafficVolumeId={entry.traffic_volume_id}
          className="inline-flex min-w-0"
        >
          <span className="truncate text-sm font-semibold text-white/90">
            {entry.traffic_volume_id}
          </span>
        </TrafficVolumeInfoTooltip>
      </div>
      <div className="flex flex-wrap justify-end gap-1.5 text-[11px]">
        {category === "new" ? (
          <>
            <span className="rounded-full border border-rose-300/20 bg-black/20 px-2 py-0.5 text-rose-100">
              {formatBinPill(entry.new_hotspot_bin_count, "new")}
            </span>
            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-white/75">
              {formatSegmentPill(entry.new_hotspot_segment_count)}
            </span>
          </>
        ) : null}
        {category === "extinguished" ? (
          <>
            <span className="rounded-full border border-emerald-300/20 bg-black/20 px-2 py-0.5 text-emerald-100">
              {formatBinPill(entry.extinguished_hotspot_bin_count, "extinguished")}
            </span>
            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-white/75">
              {formatSegmentPill(entry.extinguished_hotspot_segment_count)}
            </span>
          </>
        ) : null}
        {category === "changed" ? (
          <>
            <span className="rounded-full border border-sky-300/20 bg-black/20 px-2 py-0.5 text-sky-100">
              {formatBinPill(entry.new_hotspot_bin_count, "new")}
            </span>
            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-white/80">
              {formatBinPill(entry.extinguished_hotspot_bin_count, "extinguished")}
            </span>
            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-white/75">
              {formatSegmentPill(
                entry.new_hotspot_segment_count +
                  entry.extinguished_hotspot_segment_count,
              )}
            </span>
          </>
        ) : null}
      </div>
    </>
  );

  if (typeof onRevealTv !== "function") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/15 px-3 py-2">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-left transition-colors hover:border-white/20 hover:bg-black/25"
      onClick={() => onRevealTv(entry.traffic_volume_id)}
    >
      {content}
    </button>
  );
}

const CategorySection = memo(function CategorySection({
  config,
  entries,
  visibleCount,
  onToggleVisibility,
  onRevealTv,
}: {
  config: CategoryConfig;
  entries: HotspotDiffCategoryEntry[];
  visibleCount: number;
  onToggleVisibility: (key: HotspotDiffCategoryKey) => void;
  onRevealTv?: (tvId: string) => void;
}) {
  const displayed = entries.slice(0, visibleCount);
  const hiddenCount = Math.max(0, entries.length - displayed.length);
  const canCollapse = entries.length > DEFAULT_VISIBLE_COUNT && displayed.length > DEFAULT_VISIBLE_COUNT;
  const showCollapse = hiddenCount === 0 && canCollapse;

  return (
    <section
      className={`rounded-2xl border p-4 ${config.panelClassName}`}
      aria-label={config.title}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-white/90">{config.title}</h4>
          <p className="mt-1 text-xs text-white/65">{config.description}</p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${config.badgeClassName}`}
        >
          {entries.length} TV{entries.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {displayed.length > 0 ? (
          displayed.map((entry) => (
            <HotspotSummaryRow
              key={`${config.key}-${entry.traffic_volume_id}`}
              category={config.key}
              entry={entry}
              onRevealTv={onRevealTv}
            />
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-white/15 bg-black/10 px-3 py-4 text-xs text-white/60">
            {config.emptyLabel}
          </div>
        )}
      </div>

      {entries.length > DEFAULT_VISIBLE_COUNT ? (
        <button
          type="button"
          className="mt-3 text-xs font-medium text-white/75 transition-colors hover:text-white"
          onClick={() => onToggleVisibility(config.key)}
        >
          {showCollapse ? "See less" : formatSeeMoreTvLabel(hiddenCount)}
        </button>
      ) : null}
    </section>
  );
});

function HotspotDiffSummaryCardInner({
  hotspotDiffs,
  tvOrder,
  binMinutes,
  viewFrom,
  viewTo,
  onRevealTv,
}: HotspotDiffSummaryCardProps) {
  const categories = useMemo(
    () =>
      buildHotspotDiffCategories({
        hotspotDiffs,
        tvOrder,
        binMinutes,
        viewFrom,
        viewTo,
      }),
    [hotspotDiffs, tvOrder, binMinutes, viewFrom, viewTo],
  );
  const [visibleCounts, setVisibleCounts] = useState<Record<HotspotDiffCategoryKey, number>>({
    new: DEFAULT_VISIBLE_COUNT,
    extinguished: DEFAULT_VISIBLE_COUNT,
    changed: DEFAULT_VISIBLE_COUNT,
  });

  const totalEntries =
    categories.new.length + categories.extinguished.length + categories.changed.length;

  const handleToggleVisibility = (key: HotspotDiffCategoryKey) => {
    setVisibleCounts((current) => {
      const entries = categories[key];
      const expanded = current[key] > DEFAULT_VISIBLE_COUNT || current[key] >= entries.length;
      return {
        ...current,
        [key]: expanded ? DEFAULT_VISIBLE_COUNT : entries.length,
      };
    });
  };

  if (!hotspotDiffs) return null;

  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-black/25 p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-white/60">
            Hotspot pattern summary
          </div>
          <h3 className="mt-1 text-sm font-semibold text-white/90">
            What changed in the visible time window
          </h3>
          <p className="mt-1 text-xs text-white/60">
            Uses hotspot deltas for {viewFrom} to {viewTo}. Click a TV to jump to its chart.
          </p>
        </div>
        <div className="text-[11px] uppercase tracking-wide text-white/45">
          {totalEntries} categorized rows
        </div>
      </div>

      {totalEntries === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-white/15 bg-black/15 px-4 py-5 text-sm text-white/70">
          No hotspot pattern changes in this window.
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
          {CATEGORY_CONFIG.map((config) => (
            <CategorySection
              key={config.key}
              config={config}
              entries={categories[config.key]}
              visibleCount={visibleCounts[config.key]}
              onToggleVisibility={handleToggleVisibility}
              onRevealTv={onRevealTv}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const HotspotDiffSummaryCard = memo(HotspotDiffSummaryCardInner);

export default HotspotDiffSummaryCard;
