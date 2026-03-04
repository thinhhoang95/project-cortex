"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ComposedChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Line } from "recharts";
import { binIndexToRangeLabel, hhmmToMinutesSafe } from "@/lib/time";
import { formatSeeMoreLabel, SEE_LESS_LABEL } from "@/lib/seeMoreLess";
import type { OccupancySeriesByTv } from "@/lib/models";
import TrafficVolumeInfoTooltip from "./TrafficVolumeInfoTooltip";
import TrafficOverloadBar, { TrafficOverloadDatum } from "./TrafficOverloadBar";
import TrafficVolumeReliefMap from "@/components/TrafficVolumeReliefMap";
import { computeNetDeltaByTv } from "@/lib/trafficVolumeRelief";

const PAGE_SIZE = 20;
const CAPACITY_HIDE_THRESHOLD = 998;

type SortMode = "total" | "abs_change" | "relative_change" | "exceedance";

export interface OccupancyPrePostPanelProps {
  postCounts: OccupancySeriesByTv;
  preCounts?: OccupancySeriesByTv;
  capacity?: OccupancySeriesByTv;
  tvOrder?: string[];
  binMinutes: number;
  viewFrom: string;
  viewTo: string;
  initialLimit?: number;
  sortMode?: SortMode;
  defaultSortMode?: SortMode;
  onSortModeChange?: (m: SortMode) => void;
  fetchPre?: (tvIds: string[]) => Promise<{ preCounts: OccupancySeriesByTv; capacity?: OccupancySeriesByTv; binMinutes?: number }>;
  loading?: boolean;
  error?: string | null;
  onMismatchBinMinutes?: (actual: number) => void;
  title?: string;
  compact?: boolean;
  showLabels?: boolean; // default true
  pinnedTvIds?: string[];
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

export default function OccupancyPrePostPanel({
  postCounts,
  preCounts,
  capacity,
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
  pinnedTvIds,
  showReliefMap = false,
  reliefMapTitle = "Traffic Volume Relief Map",
}: OccupancyPrePostPanelProps) {
  // Internal state for uncontrolled sort mode
  const [internalSort, setInternalSort] = useState<SortMode>(defaultSortMode);
  const effectiveSort: SortMode = sortMode || internalSort;

  const pinnedSet = useMemo(() => {
    if (!Array.isArray(pinnedTvIds) || pinnedTvIds.length === 0) return new Set<string>();
    const set = new Set<string>();
    pinnedTvIds.forEach((tv) => {
      if (typeof tv !== "string") return;
      const trimmed = tv.trim();
      if (trimmed) set.add(trimmed);
    });
    return set;
  }, [pinnedTvIds]);

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

  // Build rows per TV filtered by time window
  const vFrom = hhmmToMinutesSafe(viewFrom);
  const vTo = hhmmToMinutesSafe(viewTo);

  const rowsByTv = useMemo(() => {
    const map = new Map<string, TvRowPoint[]>();
    for (const tv of UNION_TVS) {
      const A = effectivePre?.[tv];
      const B = postCounts?.[tv];
      const C = effectiveCap?.[tv];
      const hasA = Array.isArray(A) && A.length > 0;
      const hasB = Array.isArray(B) && B.length > 0;
      const hasC = Array.isArray(C) && C.length > 0;
      if (!hasA && !hasB && !hasC) { map.set(tv, []); continue; }
      const n = hasA && hasB ? Math.min(A!.length, B!.length) : Math.max((A || []).length, (B || []).length);
      const arr: TvRowPoint[] = new Array(n).fill(0).map((_, i) => {
        const startMin = i * binMinutes;
        const a = Number((A || [])[i] ?? 0);
        const b = Number((B || [])[i] ?? 0);
        const aa = Number.isFinite(a) ? a : 0;
        const bb = Number.isFinite(b) ? b : 0;
        const base = Math.min(aa, bb);
        const inc = Math.max(0, bb - aa);
        const dec = Math.max(0, aa - bb);
        const capRaw = Number((C || [])[i] ?? NaN);
        const cap =
          Number.isFinite(capRaw) && capRaw <= CAPACITY_HIDE_THRESHOLD ? capRaw : null;
        return { idx: i, startMin, base, inc, dec, pre: aa, post: bb, cap };
      });
      const filtered = arr.filter((r) => r.startMin >= vFrom && r.startMin <= vTo);
      map.set(tv, filtered);
    }
    return map;
  }, [UNION_TVS, effectivePre, postCounts, effectiveCap, binMinutes, vFrom, vTo]);

  const exceedanceNormalization = useMemo(() => (binMinutes > 0 ? binMinutes / 60 : 1), [binMinutes]);

  // Compute sort scores
  const scoresByTv = useMemo(() => {
    const s: Record<string, number> = {};
    for (const tv of UNION_TVS) {
      const rows = rowsByTv.get(tv) || [];
      if (effectiveSort === 'total') {
        const preferPost = Array.isArray(postCounts?.[tv]) && (postCounts?.[tv] || []).length > 0;
        const series = preferPost ? 'post' : 'pre';
        s[tv] = rows.reduce((acc, r) => acc + (series === 'post' ? (r.post || 0) : (r.pre || 0)), 0);
      } else if (effectiveSort === 'abs_change') {
        const hasA = Array.isArray(effectivePre?.[tv]) && (effectivePre?.[tv] || []).length > 0;
        const hasB = Array.isArray(postCounts?.[tv]) && (postCounts?.[tv] || []).length > 0;
        if (!hasA || !hasB) { s[tv] = 0; continue; }
        s[tv] = rows.reduce((acc, r) => acc + Math.abs((r.post || 0) - (r.pre || 0)), 0);
      } else if (effectiveSort === 'relative_change') {
        const hasA = Array.isArray(effectivePre?.[tv]) && (effectivePre?.[tv] || []).length > 0;
        const hasB = Array.isArray(postCounts?.[tv]) && (postCounts?.[tv] || []).length > 0;
        if (!hasA || !hasB) {
          s[tv] = 0;
          continue;
        }
        let deltaSum = 0;
        let baseSum = 0;
        for (const r of rows) {
          const preVal = r.pre ?? 0;
          const postVal = r.post ?? preVal;
          deltaSum += Math.abs(postVal - preVal);
          baseSum += Math.abs(preVal);
        }
        if (baseSum > 0) {
          s[tv] = deltaSum / baseSum;
        } else {
          s[tv] = deltaSum > 0 ? Number.MAX_SAFE_INTEGER : 0;
        }
      } else {
        // exceedance: sum positive (display - capacity) using display = post if available else pre
        const preferPost = Array.isArray(postCounts?.[tv]) && (postCounts?.[tv] || []).length > 0;
        s[tv] = rows.reduce((acc, r) => {
          const d = preferPost ? (r.post || 0) : (r.pre || 0);
          const c = Number.isFinite(r.cap as number) && (r.cap as number) >= 0 ? (r.cap as number) : Number.POSITIVE_INFINITY;
          return acc + Math.max(0, d - c) * exceedanceNormalization;
        }, 0);
      }
    }
    return s;
  }, [UNION_TVS, rowsByTv, postCounts, effectivePre, effectiveSort, exceedanceNormalization]);

  // Sorted TVs with stable tie-breakers
  const sortedTvs = useMemo(() => {
    const orderIndex: Record<string, number> = {};
    (tvOrder || []).forEach((tv, idx) => { orderIndex[String(tv)] = idx; });
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
  }, [UNION_TVS, scoresByTv, tvOrder]);

  const pinnedTvs = useMemo(() => sortedTvs.filter((tv) => pinnedSet.has(tv)), [sortedTvs, pinnedSet]);
  const unpinnedTvs = useMemo(() => sortedTvs.filter((tv) => !pinnedSet.has(tv)), [sortedTvs, pinnedSet]);
  const unpinnedCount = unpinnedTvs.length;

  const [visibleNonPinnedCount, setVisibleNonPinnedCount] = useState<number>(initialLimit);

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

  const isLoading = Boolean(loading) || internalLoading;
  const err = error || internalError || null;

  const reliefDeltasByTv = useMemo(() => {
    return computeNetDeltaByTv({
      preCounts: effectivePre,
      postCounts,
      binMinutes,
      viewFrom,
      viewTo,
      tvIds: UNION_TVS,
    });
  }, [effectivePre, postCounts, binMinutes, viewFrom, viewTo, UNION_TVS]);
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
      {isLoading && <div className="text-xs text-white/70 mb-2">Loading...</div>}

      {showReliefMap && (
        <div className="mb-4 rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="text-[11px] uppercase tracking-wider text-white/60 mb-2">{reliefMapTitle}</div>
          <TrafficVolumeReliefMap
            deltasByTv={reliefDeltasByTv}
            loading={isLoading}
            emptyMessage={reliefMapEmptyMessage}
          />
        </div>
      )}

      {/* Grid of per-TV charts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-3 gap-4">
        {displayTvs.map((tv) => {
          const isPinned = pinnedSet.has(tv);
          const rows = rowsByTv.get(tv) || [];
          const hasData = rows.length > 0;
          const preSegments = buildOverloadSegments(rows, binMinutes, tv, 'pre');
          const postSegments = buildOverloadSegments(rows, binMinutes, tv, 'post');
          const hasPreSeries = Array.isArray(effectivePre?.[tv]) && (effectivePre?.[tv] || []).length > 0;
          const hasPostSeries = Array.isArray(postCounts?.[tv]) && (postCounts?.[tv] || []).length > 0;
          return (
            <div
              key={tv}
              className={`rounded-xl border p-3 transition ${
                isPinned
                  ? "border-emerald-300/60 bg-emerald-500/10 shadow-[0_16px_32px_-28px_rgba(16,185,129,0.6)]"
                  : "border-white/10 bg-white/5"
              }`}
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
                    <Bar dataKey="base" stackId="a" fill="#60a5fa" name="base" />
                    <Bar dataKey="inc" stackId="a" fill="#ef4444" name="inc" />
                    <Bar dataKey="dec" stackId="a" fill="#22c55e" name="dec" />
                    {/* capacity overlay if present */}
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
        })}
      </div>

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

function buildOverloadSegments(
  rows: TvRowPoint[],
  binMinutes: number,
  tvId: string,
  series: 'pre' | 'post',
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
    if (occupancy <= capacity) return;

    const ratio = capacity > 0 ? occupancy / capacity : Infinity;
    let color = "#fb923c";
    if (ratio >= 1.4) {
      color = "#b91c1c";
    } else if (ratio >= 1.2) {
      color = "#f97316";
    }

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
