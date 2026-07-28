"use client";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ComposedChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Line } from "recharts";
import { binIndexToRangeLabel, hhmmToMinutesSafe } from "@/lib/time";
import { formatSeeMoreLabel, SEE_LESS_LABEL } from "@/lib/seeMoreLess";
import type { OccupancySeriesByTv, WithHotspotDiffs } from "@/lib/models";
import {
  computeOccupancyWindowStatsByTv,
  getOccupancyWindowRange,
  OCCUPANCY_CAPACITY_HIDE_THRESHOLD,
  scoreOccupancyTvWindowStats,
  type OccupancyWindowSortMode,
} from "@/lib/occupancyWindowStats";
import TrafficVolumeInfoTooltip from "./TrafficVolumeInfoTooltip";
import TrafficOverloadBar, { TrafficOverloadDatum } from "./TrafficOverloadBar";
import TrafficVolumeReliefMap from "@/components/TrafficVolumeReliefMap";
import ShimmeringText from "@/components/ShimmeringText";
import HotspotDiffSummaryCard from "@/components/HotspotDiffSummaryCard";
import { useHotspotSettingsStore } from "@/components/useHotspotSettingsStore";
import GlobalTVBasket from "@/components/GlobalTVBasket";
import { useGlobalTVBasket } from "@/components/useGlobalTVBasket";
import {
  resolveHotspotColor,
  type HotspotColoringSettings,
} from "@/lib/hotspotColoring";

const PAGE_SIZE = 20;
export type OccupancyPrePostSortMode = OccupancyWindowSortMode;

export interface OccupancyPrePostPanelProps {
  postCounts: OccupancySeriesByTv;
  preCounts?: OccupancySeriesByTv;
  capacity?: OccupancySeriesByTv;
  hotspotDiffs?: Partial<WithHotspotDiffs> | null;
  tvOrder?: string[];
  binMinutes: number;
  viewFrom: string;
  viewTo: string;
  initialLimit?: number;
  sortMode?: OccupancyPrePostSortMode;
  defaultSortMode?: OccupancyPrePostSortMode;
  onSortModeChange?: (m: OccupancyPrePostSortMode) => void;
  fetchPre?: (tvIds: string[]) => Promise<{ preCounts: OccupancySeriesByTv; capacity?: OccupancySeriesByTv; binMinutes?: number }>;
  loading?: boolean;
  error?: string | null;
  onMismatchBinMinutes?: (actual: number) => void;
  title?: string;
  compact?: boolean;
  showLabels?: boolean; // default true
  showGlobalTVBasket?: boolean;
  showReliefMap?: boolean;
  reliefMapTitle?: string;
}

interface TvRowPoint {
  idx: number;
  startMin: number;
  base: number;
  inc: number;
  dec: number;
  pre?: number;
  post?: number;
  cap?: number | null;
}

const EMPTY_ROWS: TvRowPoint[] = [];

interface TvChartCardProps {
  tv: string;
  rows: TvRowPoint[];
  isPinned: boolean;
  isFocused: boolean;
  compact?: boolean;
  binMinutes: number;
  showLabels: boolean;
  viewFrom: string;
  viewTo: string;
  hasPreSeries: boolean;
  hasPostSeries: boolean;
}

const TvChartCard = memo(function TvChartCard({
  tv, rows, isPinned, isFocused, compact, binMinutes, showLabels, viewFrom, viewTo, hasPreSeries, hasPostSeries,
}: TvChartCardProps) {
  const hasData = rows.length > 0;
  const hotspotSettings = useHotspotSettingsStore((state) => state.settings);
  const preSegments = useMemo(
    () => buildOverloadSegments(rows, binMinutes, tv, 'pre', hotspotSettings),
    [binMinutes, hotspotSettings, rows, tv],
  );
  const postSegments = useMemo(
    () => buildOverloadSegments(rows, binMinutes, tv, 'post', hotspotSettings),
    [binMinutes, hotspotSettings, rows, tv],
  );

  return (
    <div
      className={`rounded-xl border p-3 transition ${
        isPinned
          ? "border-emerald-300/60 bg-emerald-500/10 shadow-[0_16px_32px_-28px_rgba(16,185,129,0.6)]"
          : "border-white/10 bg-white/5"
      } ${isFocused ? "ring-2 ring-sky-300/45 shadow-[0_0_0_1px_rgba(125,211,252,0.2),0_18px_38px_-26px_rgba(56,189,248,0.85)]" : ""}`}
    >
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="text-sm font-semibold text-white/90 truncate">
          <TrafficVolumeInfoTooltip trafficVolumeId={tv} className="truncate max-w-full">
            <span className="truncate">{tv}</span>
          </TrafficVolumeInfoTooltip>
        </div>
        {isPinned ? (
          <span className="shrink-0 rounded-full border border-emerald-300/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
            Pinned
          </span>
        ) : null}
      </div>
      <div className={compact ? "h-32" : "h-36"}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
            <XAxis
              dataKey="idx"
              tick={showLabels ? { fontSize: 10 } : false}
              axisLine={showLabels}
              tickLine={showLabels}
              hide={false}
              interval="preserveStartEnd"
              tickFormatter={(value: any) => {
                const i = Number(value ?? 0);
                return binIndexToRangeLabel(i, binMinutes);
              }}
            />
            <YAxis tick={showLabels ? { fontSize: 10 } : false} axisLine={showLabels} tickLine={showLabels} width={showLabels ? 32 : 0} />
            <Tooltip
              contentStyle={{ background: "rgba(15,23,42,0.9)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "white" }}
              formatter={(value: any, name: any, ctx: any) => {
                const i = ctx?.payload?.idx ?? 0;
                const pre = ctx?.payload?.pre ?? 0;
                const post = ctx?.payload?.post ?? 0;
                const cap = ctx?.payload?.cap;
                if (name === 'inc') return [`+${value}`, 'Post-Pre'];
                if (name === 'dec') return [`-${value}`, 'Pre-Post'];
                if (name === 'base') return [String(value), 'Base'];
                return [String(value), String(name)];
              }}
              labelFormatter={(label: any) => {
                const i = Number(label ?? 0);
                return binIndexToRangeLabel(i, binMinutes);
              }}
            />
            <Bar dataKey="base" stackId="a" fill="#60a5fa" name="base" isAnimationActive={false} />
            <Bar dataKey="inc" stackId="a" fill="#ef4444" name="inc" isAnimationActive={false} />
            <Bar dataKey="dec" stackId="a" fill="#22c55e" name="dec" isAnimationActive={false} />
            <Line type="monotone" dataKey="cap" name="Capacity" stroke="#f59e0b" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 space-y-1.5">
        {hasPreSeries && (
          <div className="flex items-center gap-2 text-[11px] text-white/70">
            <div className="shrink-0 w-12 uppercase tracking-wider text-white/60">Pre</div>
            <div className="grow min-w-0">
              <TrafficOverloadBar fromTime={viewFrom} toTime={viewTo} data={preSegments} showTime={preSegments.length > 0} showOkWhenNoData={false} />
            </div>
          </div>
        )}
        {hasPostSeries && (
          <div className="flex items-center gap-2 text-[11px] text-white/70">
            <div className="shrink-0 w-12 uppercase tracking-wider text-white/60">Post</div>
            <div className="grow min-w-0">
              <TrafficOverloadBar fromTime={viewFrom} toTime={viewTo} data={postSegments} showTime={postSegments.length > 0} showOkWhenNoData={false} />
            </div>
          </div>
        )}
        {!hasPreSeries && !hasPostSeries && (
          <TrafficOverloadBar fromTime={viewFrom} toTime={viewTo} data={[]} showTime={false} showOkWhenNoData={false} />
        )}
      </div>
      {!hasData && <div className="text-[11px] text-gray-300 mt-2">No data in selected time window.</div>}
    </div>
  );
});

function OccupancyPrePostPanelInner({
  postCounts,
  preCounts,
  capacity,
  hotspotDiffs,
  tvOrder,
  binMinutes,
  viewFrom,
  viewTo,
  initialLimit = 12,
  sortMode,
  defaultSortMode = "total",
  onSortModeChange,
  fetchPre,
  loading,
  error,
  onMismatchBinMinutes,
  title,
  compact,
  showLabels = true,
  showGlobalTVBasket = true,
  showReliefMap = false,
  reliefMapTitle = "Traffic Volume Relief Map",
}: OccupancyPrePostPanelProps) {
  // Internal state for uncontrolled sort mode
  const [internalSort] = useState<OccupancyPrePostSortMode>(defaultSortMode);
  const effectiveSort: OccupancyPrePostSortMode = sortMode || internalSort;

  const UNION_TVS = useMemo(() => {
    const s = new Set<string>();
    for (const k of Object.keys(postCounts || {})) s.add(String(k));
    for (const k of Object.keys(preCounts || {})) s.add(String(k));
    for (const k of Object.keys(capacity || {})) s.add(String(k));
    for (const k of (tvOrder || [])) s.add(String(k));
    // Only keep TVs that actually have any series
    const arr = Array.from(s).filter((tv) => {
      const p1 = postCounts?.[tv];
      const p0 = preCounts?.[tv];
      const cap = capacity?.[tv];
      return (Array.isArray(p1) && p1.length > 0) || (Array.isArray(p0) && p0.length > 0) || (Array.isArray(cap) && cap.length > 0);
    });
    return arr;
  }, [postCounts, preCounts, capacity, tvOrder]);
  const basketScope = useGlobalTVBasket(UNION_TVS);
  const pinnedSet = useMemo(
    () => new Set(basketScope.activePinnedIds.map((tv) => tv.toLocaleUpperCase())),
    [basketScope.activePinnedIds],
  );

  // Internal fetch of pre if not provided
  const [fetchedPre, setFetchedPre] = useState<OccupancySeriesByTv | null>(null);
  const [fetchedCap, setFetchedCap] = useState<OccupancySeriesByTv | null>(null);
  const [fetchedBin, setFetchedBin] = useState<number | null>(null);
  const [internalLoading, setInternalLoading] = useState<boolean>(false);
  const [internalError, setInternalError] = useState<string | null>(null);
  const lastFetchKey = useRef<string | null>(null);
  useEffect(() => {
    const needFetch = !preCounts && typeof fetchPre === 'function' && UNION_TVS.length > 0;
    if (!needFetch) return;
    const key = JSON.stringify(UNION_TVS.slice().sort());
    if (lastFetchKey.current === key && (fetchedPre || internalError)) return;
    let cancelled = false;
    (async () => {
      try {
        setInternalLoading(true);
        setInternalError(null);
        const res = await fetchPre(UNION_TVS);
        if (cancelled) return;
        setFetchedPre(res.preCounts || {});
        setFetchedCap(res.capacity || null);
        if (Number.isFinite(res.binMinutes)) {
          setFetchedBin(Number(res.binMinutes));
          if (Number(res.binMinutes) !== binMinutes) {
            onMismatchBinMinutes?.(Number(res.binMinutes));
          }
        }
        lastFetchKey.current = key;
      } catch (e: any) {
        if (cancelled) return;
        setInternalError(e?.message || 'Failed to fetch pre counts.');
      } finally {
        if (!cancelled) setInternalLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [UNION_TVS, preCounts, fetchPre, binMinutes, onMismatchBinMinutes, fetchedPre, internalError]);

  const effectivePre = preCounts || fetchedPre || {};
  const effectiveCap = capacity || fetchedCap || undefined;
  const mismatchBin = Number.isFinite(fetchedBin) && fetchedBin !== binMinutes;

  // Availability flags for sort control enablement (even if control is external)
  const hasBothPrePostForAny = useMemo(() => UNION_TVS.some(tv => Array.isArray(effectivePre?.[tv]) && Array.isArray(postCounts?.[tv]) && (effectivePre?.[tv] || []).length > 0 && (postCounts?.[tv] || []).length > 0), [UNION_TVS, effectivePre, postCounts]);
  const windowRange = useMemo(
    () => getOccupancyWindowRange(hhmmToMinutesSafe(viewFrom), hhmmToMinutesSafe(viewTo), binMinutes),
    [viewFrom, viewTo, binMinutes],
  );
  const statsByTv = useMemo(
    () =>
      computeOccupancyWindowStatsByTv({
        postCounts,
        preCounts: effectivePre,
        capacity: effectiveCap,
        tvIds: UNION_TVS,
        windowRange,
        binMinutes,
        capacityHideThreshold: OCCUPANCY_CAPACITY_HIDE_THRESHOLD,
      }),
    [postCounts, effectivePre, effectiveCap, UNION_TVS, windowRange, binMinutes],
  );
  const orderIndex = useMemo(() => {
    const index: Record<string, number> = {};
    (tvOrder || []).forEach((tv, idx) => {
      index[String(tv)] = idx;
    });
    return index;
  }, [tvOrder]);

  // Compute sort scores
  const scoresByTv = useMemo(() => {
    const s: Record<string, number> = {};
    for (const tv of UNION_TVS) {
      s[tv] = scoreOccupancyTvWindowStats(statsByTv[tv], effectiveSort);
    }
    return s;
  }, [UNION_TVS, statsByTv, effectiveSort]);

  // Sorted TVs with stable tie-breakers
  const sortedTvs = useMemo(() => {
    const arr = UNION_TVS.slice();
    arr.sort((a, b) => {
      const sa = Number(scoresByTv[a] || 0);
      const sb = Number(scoresByTv[b] || 0);
      if (sa !== sb) return sb - sa;
      const ia = Number.isFinite(orderIndex[a]) ? orderIndex[a] : Number.POSITIVE_INFINITY;
      const ib = Number.isFinite(orderIndex[b]) ? orderIndex[b] : Number.POSITIVE_INFINITY;
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b);
    });
    return arr;
  }, [UNION_TVS, scoresByTv, orderIndex]);

  const scopedSortedTvs = useMemo(
    () => sortedTvs.filter((tv) => basketScope.includedContextIds.has(tv)),
    [basketScope.includedContextIds, sortedTvs],
  );
  const scopedByKey = useMemo(
    () => new Map(scopedSortedTvs.map((tv) => [tv.toLocaleUpperCase(), tv])),
    [scopedSortedTvs],
  );
  const pinnedTvs = useMemo(
    () => basketScope.activePinnedIds
      .map((tv) => scopedByKey.get(tv.toLocaleUpperCase()))
      .filter((tv): tv is string => Boolean(tv)),
    [basketScope.activePinnedIds, scopedByKey],
  );
  const unpinnedTvs = useMemo(
    () => scopedSortedTvs.filter((tv) => !pinnedSet.has(tv.toLocaleUpperCase())),
    [pinnedSet, scopedSortedTvs],
  );
  const unpinnedCount = unpinnedTvs.length;

  const [visibleNonPinnedCount, setVisibleNonPinnedCount] = useState<number>(initialLimit);
  const [pendingRevealTvId, setPendingRevealTvId] = useState<string | null>(null);
  const [focusedTvId, setFocusedTvId] = useState<string | null>(null);
  const tvCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    setVisibleNonPinnedCount((current) => {
      const next = Math.min(unpinnedCount, Math.max(initialLimit, current));
      return next === current ? current : next;
    });
  }, [initialLimit, unpinnedCount]);

  const limitedNonPinnedCount = Math.min(unpinnedCount, visibleNonPinnedCount);
  const displayTvs = useMemo(() => {
    if (pinnedTvs.length === 0) {
      return unpinnedTvs.slice(0, limitedNonPinnedCount);
    }
    if (limitedNonPinnedCount >= unpinnedCount) {
      return [...pinnedTvs, ...unpinnedTvs];
    }
    return [...pinnedTvs, ...unpinnedTvs.slice(0, limitedNonPinnedCount)];
  }, [pinnedTvs, unpinnedTvs, limitedNonPinnedCount, unpinnedCount]);

  const hiddenTvCount = Math.max(0, unpinnedCount - limitedNonPinnedCount);
  const canCollapse = unpinnedCount > initialLimit && limitedNonPinnedCount > initialLimit;
  const showSeeLess = hiddenTvCount === 0 && canCollapse;
  const paginationLabel = showSeeLess ? SEE_LESS_LABEL : formatSeeMoreLabel(hiddenTvCount);
  const paginationDisabled = !showSeeLess && hiddenTvCount === 0;

  const handlePagination = () => {
    if (showSeeLess) {
      setVisibleNonPinnedCount(initialLimit);
    } else if (hiddenTvCount > 0) {
      setVisibleNonPinnedCount((current) =>
        Math.min(unpinnedCount, current + PAGE_SIZE),
      );
    }
  };

  const handleRevealTv = (tvId: string) => {
    const normalized = String(tvId ?? "").trim();
    if (!normalized) return;
    const unpinnedIndex = unpinnedTvs.indexOf(normalized);
    if (unpinnedIndex >= 0) {
      setVisibleNonPinnedCount((current) =>
        Math.max(current, Math.min(unpinnedCount, unpinnedIndex + 1)),
      );
    }
    setPendingRevealTvId(normalized);
  };

  useEffect(() => {
    if (!pendingRevealTvId) return;
    if (!displayTvs.includes(pendingRevealTvId)) return;
    const element = tvCardRefs.current.get(pendingRevealTvId);
    if (!element) return;
    const rafId = window.requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setFocusedTvId(pendingRevealTvId);
      setPendingRevealTvId(null);
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [displayTvs, pendingRevealTvId]);

  useEffect(() => {
    if (!focusedTvId) return;
    const timeoutId = window.setTimeout(() => {
      setFocusedTvId((current) => (current === focusedTvId ? null : current));
    }, 1800);
    return () => window.clearTimeout(timeoutId);
  }, [focusedTvId]);

  const isLoading = Boolean(loading) || internalLoading;
  const err = error || internalError || null;

  const reliefDeltasByTv = useMemo(() => {
    if (!showReliefMap) return null;
    const deltas: Record<string, number> = {};
    for (const tv of UNION_TVS) {
      const stats = statsByTv[tv];
      if (!stats?.hasPreSeries || !stats.hasPostSeries) continue;
      deltas[tv] = stats.netDelta;
    }
    return deltas;
  }, [showReliefMap, UNION_TVS, statsByTv]);
  const rowsByDisplayedTv = useMemo(() => {
    const map = new Map<string, TvRowPoint[]>();
    for (const tv of displayTvs) {
      map.set(
        tv,
        buildRowsForWindow({
          preSeries: effectivePre?.[tv],
          postSeries: postCounts?.[tv],
          capacitySeries: effectiveCap?.[tv],
          binMinutes,
          startIndex: windowRange.startIndex,
          endIndex: windowRange.endIndex,
        }),
      );
    }
    return map;
  }, [displayTvs, effectivePre, postCounts, effectiveCap, binMinutes, windowRange]);
  const reliefMapEmptyMessage = hasBothPrePostForAny
    ? "No pre/post occupancy deltas in the selected time window."
    : "Pre and post occupancy series are required to display relief and strain.";

  return (
    <div>
      {title && (
        <div className="text-[11px] uppercase tracking-wider text-white/60 mb-2">{title}</div>
      )}
      {mismatchBin && (
        <div className="text-[11px] text-amber-300 mb-2">Warning: fetched bin size ({fetchedBin}m) differs from expected ({binMinutes}m). Using {binMinutes}m for axes.</div>
      )}
      {err && <div className="text-xs text-rose-300 mb-2">{err}</div>}
      {isLoading && (
        <ShimmeringText
          text="Loading..."
          className="mb-2 text-xs text-white/70 font-normal"
          theme="dark"
        />
      )}

      {showGlobalTVBasket && (
        <GlobalTVBasket contextTvIds={UNION_TVS} className="mb-4" compact={compact} />
      )}

      {hotspotDiffs ? (
        <HotspotDiffSummaryCard
          hotspotDiffs={hotspotDiffs}
          tvOrder={tvOrder && tvOrder.length > 0 ? tvOrder : UNION_TVS}
          binMinutes={binMinutes}
          viewFrom={viewFrom}
          viewTo={viewTo}
          onRevealTv={handleRevealTv}
        />
      ) : null}

      {showReliefMap && (
        <div className="mb-4 rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="text-[11px] uppercase tracking-wider text-white/60 mb-2">{reliefMapTitle}</div>
          <TrafficVolumeReliefMap
            deltasByTv={reliefDeltasByTv ?? {}}
            loading={isLoading}
            emptyMessage={reliefMapEmptyMessage}
          />
        </div>
      )}

      {/* Grid of per-TV charts */}
      <div className="grid grid-cols-1 gap-4 transition-opacity duration-200 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {displayTvs.map((tv) => {
          const isPinned = pinnedSet.has(tv.toLocaleUpperCase());
          const rows = rowsByDisplayedTv.get(tv) ?? EMPTY_ROWS;
          const stats = statsByTv[tv];
          const hasPreSeries = Boolean(stats?.hasPreSeries);
          const hasPostSeries = Boolean(stats?.hasPostSeries);
          return (
            <div
              key={tv}
              ref={(element) => {
                if (element) {
                  tvCardRefs.current.set(tv, element);
                } else {
                  tvCardRefs.current.delete(tv);
                }
              }}
            >
              <TvChartCard
                tv={tv}
                rows={rows}
                isPinned={isPinned}
                isFocused={focusedTvId === tv}
                compact={compact}
                binMinutes={binMinutes}
                showLabels={showLabels}
                viewFrom={viewFrom}
                viewTo={viewTo}
                hasPreSeries={hasPreSeries}
                hasPostSeries={hasPostSeries}
              />
            </div>
          );
        })}
      </div>
      {!isLoading && displayTvs.length === 0 && (
        <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.02] px-4 py-6 text-center text-xs text-white/60">
          {basketScope.isFiltering
            ? "No traffic volumes in this result match the global basket scope."
            : "No traffic-volume occupancy data is available."}
        </div>
      )}

      {/* Footer: pagination + sort availability note for external controls */}
      <div className="mt-3 flex items-center text-xs">
        <button
          className="px-3 py-1 rounded-lg border border-white/20 bg-white/10 text-white/80 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handlePagination}
          disabled={paginationDisabled}
        >
          {paginationLabel}
        </button>
      </div>
    </div>
  );
}

const OccupancyPrePostPanel = memo(OccupancyPrePostPanelInner, (prev, next) =>
  prev.postCounts === next.postCounts &&
  prev.preCounts === next.preCounts &&
  prev.capacity === next.capacity &&
  prev.hotspotDiffs === next.hotspotDiffs &&
  prev.tvOrder === next.tvOrder &&
  prev.showGlobalTVBasket === next.showGlobalTVBasket &&
  prev.sortMode === next.sortMode &&
  prev.viewFrom === next.viewFrom &&
  prev.viewTo === next.viewTo &&
  prev.binMinutes === next.binMinutes &&
  prev.loading === next.loading &&
  prev.error === next.error &&
  prev.compact === next.compact &&
  prev.showLabels === next.showLabels &&
  prev.showReliefMap === next.showReliefMap &&
  prev.initialLimit === next.initialLimit &&
  prev.title === next.title &&
  prev.defaultSortMode === next.defaultSortMode &&
  prev.reliefMapTitle === next.reliefMapTitle &&
  prev.onSortModeChange === next.onSortModeChange &&
  prev.fetchPre === next.fetchPre
);

export default OccupancyPrePostPanel;

function buildRowsForWindow(options: {
  preSeries?: number[];
  postSeries?: number[];
  capacitySeries?: number[];
  binMinutes: number;
  startIndex: number;
  endIndex: number;
}): TvRowPoint[] {
  const {
    preSeries,
    postSeries,
    capacitySeries,
    binMinutes,
    startIndex,
    endIndex,
  } = options;
  const hasPreSeries = Array.isArray(preSeries) && preSeries.length > 0;
  const hasPostSeries = Array.isArray(postSeries) && postSeries.length > 0;
  const length =
    hasPreSeries && hasPostSeries
      ? Math.min(preSeries.length, postSeries.length)
      : Math.max(preSeries?.length ?? 0, postSeries?.length ?? 0);

  if (length <= 0) return EMPTY_ROWS;

  const safeStartIndex = Math.max(0, startIndex);
  const safeEndIndex = Math.min(Math.max(safeStartIndex, endIndex), length - 1);
  if (safeStartIndex > safeEndIndex) return EMPTY_ROWS;

  const rows: TvRowPoint[] = [];
  for (let index = safeStartIndex; index <= safeEndIndex; index += 1) {
    const startMin = index * binMinutes;
    const preValueRaw = Number(preSeries?.[index] ?? 0);
    const postValueRaw = Number(postSeries?.[index] ?? 0);
    const preValue = Number.isFinite(preValueRaw) ? preValueRaw : 0;
    const postValue = Number.isFinite(postValueRaw) ? postValueRaw : 0;
    const capacityValueRaw = Number(capacitySeries?.[index] ?? NaN);
    const capacityValue =
      Number.isFinite(capacityValueRaw) && capacityValueRaw <= OCCUPANCY_CAPACITY_HIDE_THRESHOLD
        ? capacityValueRaw
        : null;

    rows.push({
      idx: index,
      startMin,
      base: Math.min(preValue, postValue),
      inc: Math.max(0, postValue - preValue),
      dec: Math.max(0, preValue - postValue),
      pre: preValue,
      post: postValue,
      cap: capacityValue,
    });
  }

  return rows;
}

function buildOverloadSegments(
  rows: TvRowPoint[],
  binMinutes: number,
  tvId: string,
  series: 'pre' | 'post',
  settings: HotspotColoringSettings,
): TrafficOverloadDatum[] {
  const segments: TrafficOverloadDatum[] = [];
  const binLength = Math.max(1, binMinutes);
  rows.forEach((row) => {
    if (row.cap == null) return;
    const capacity = row.cap;
    if (typeof capacity !== "number" || !Number.isFinite(capacity) || capacity < 0) return;

    const postVal = typeof row.post === "number" && Number.isFinite(row.post) ? row.post : null;
    const preVal = typeof row.pre === "number" && Number.isFinite(row.pre) ? row.pre : null;
    const occupancy = series === 'post' ? postVal : preVal;
    if (occupancy == null || !Number.isFinite(occupancy)) return;
    const color = resolveHotspotColor({
      traffic_volume_id: tvId,
      hourly_occupancy: occupancy,
      hourly_capacity: capacity,
    }, settings);
    if (!color) return;

    const startMinutes = typeof row.startMin === "number" ? row.startMin : NaN;
    if (!Number.isFinite(startMinutes)) return;
    const endMinutes = startMinutes + binLength;
    const startLabel = formatMinutesToHHMM(startMinutes);
    const endLabel = formatMinutesToHHMMWith24(endMinutes);
    const seriesLabel = series === 'post' ? "Post" : "Pre";

    segments.push({
      period: `${startLabel}-${endLabel}`,
      color,
      metadata: [
        `${seriesLabel}: ${occupancy.toFixed(0)}`,
        `Capacity: ${capacity.toFixed(0)}`,
        `Excess: ${(occupancy - capacity).toFixed(0)}`,
      ],
      label: `${tvId} ${seriesLabel.toLowerCase()} overload`,
    });
  });
  return segments;
}

function formatMinutesToHHMM(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes)) return "00:00";
  const minutesInDay = 24 * 60;
  const normalized = ((Math.floor(totalMinutes) % minutesInDay) + minutesInDay) % minutesInDay;
  const hh = Math.floor(normalized / 60);
  const mm = normalized % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function formatMinutesToHHMMWith24(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes)) return "00:00";
  const minutesInDay = 24 * 60;
  if (totalMinutes >= minutesInDay) {
    return "24:00";
  }
  if (totalMinutes < 0) {
    return formatMinutesToHHMM(0);
  }
  return formatMinutesToHHMM(totalMinutes);
}
