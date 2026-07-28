"use client";
import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useResourceDateGuard } from "@/components/useResourceDateGuard";
import { useSimStore } from '@/components/useSimStore';
import { useHotspotSettingsStore } from "@/components/useHotspotSettingsStore";
import Header from "@/components/Header";
import GlobalTVBasket from "@/components/GlobalTVBasket";
import { useGlobalTVBasket } from "@/components/useGlobalTVBasket";
import ShimmeringText from "@/components/ShimmeringText";
import TimeScaleControl from "@/components/TimeScaleControl";
import TrafficVolumeInfoTooltip from "@/components/TrafficVolumeInfoTooltip";
import TrafficOverloadBar, { TrafficOverloadDatum } from "@/components/TrafficOverloadBar";
import TrafficVolumeShockwaves from "@/components/TrafficVolumeShockwaves";
import SelectChevron from "@/components/SelectChevron";
import { normalizeCapacity } from "@/lib/capacity";
import { resolveHotspotColor } from "@/lib/hotspotColoring";
import { formatShockwaveHorizonLabel } from "@/lib/trafficVolumeShockwaves";
import { buildOriginalCountsRequest } from "@/lib/originalCountsRequest";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

type CountsResponse = {
  time_bin_minutes: number;
  timebins: { start_bin: number; end_bin: number; labels: string[] };
  counts?: Record<string, number[]>;
  capacity?: Record<string, number[]>;
  mentioned_counts?: Record<string, number[]>;
  mentioned_capacity?: Record<string, number[]>;
  by_category?: Record<string, Record<string, number[]>>;
  by_category_mentioned?: Record<string, Record<string, number[]>>;
  metadata: {
    num_tvs?: number;
    num_mentioned?: number;
    num_bins?: number;
    rank_by?: string;
    top_k?: number;
    rolling_hour?: boolean;
    rolling_window_minutes?: number;
    ranked_tv_ids?: string[];
    missing_flight_ids?: string[];
  };
};

const SHOCKWAVE_HORIZON_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "0", label: "T" },
  { value: "15", label: "T+15" },
  { value: "30", label: "T+30" },
  { value: "45", label: "T+45" },
  { value: "60", label: "T+60" },
  { value: "90", label: "T+90" },
  { value: "120", label: "T+120" },
  { value: "150", label: "T+150" },
  { value: "180", label: "T+180" },
];

const TV_PAGE_SIZE = 24;

const FIELD_CLASS =
  "h-10 rounded-lg border border-white/20 bg-white/10 px-3 text-sm text-white transition focus:border-sky-300/60 focus:outline-none focus:ring-1 focus:ring-sky-300/25";

type StatusTone = "danger" | "warning" | "muted";

const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  danger: "text-rose-300",
  warning: "text-amber-200",
  muted: "text-white/55",
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-wider text-white/50">{children}</span>
  );
}

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <h2 className="text-[11px] font-medium uppercase tracking-wider text-white/50">{title}</h2>
      {count > 0 && (
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-white/55">
          {count}
        </span>
      )}
      <div className="h-px flex-1 bg-white/10" />
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-center text-xs text-white/45">
      {children}
    </div>
  );
}

function ShowMoreButton({ remaining, onClick }: { remaining: number; onClick: () => void }) {
  return (
    <div className="mt-4 flex justify-center">
      <button
        onClick={onClick}
        className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/75 transition hover:border-white/25 hover:bg-white/10 hover:text-white"
      >
        Show {Math.min(remaining, TV_PAGE_SIZE)} more
        <span className="ml-1.5 text-white/40">({remaining} remaining)</span>
      </button>
    </div>
  );
}

function DebugToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2 py-1 text-[11px] transition ${
        active ? "bg-white/10 text-white/85" : "text-white/40 hover:bg-white/5 hover:text-white/70"
      }`}
    >
      {children}
    </button>
  );
}

export default function OriginalCountPage() {
  const resourceDate = useSimStore((state) => state.resourceDate);
  const basket = useGlobalTVBasket();
  const [fromTime, setFromTime] = useState<string>("00:00");
  const [toTime, setToTime] = useState<string>("23:59");
  const [rollingHour, setRollingHour] = useState<boolean>(true);
  const [rankBy, setRankBy] = useState<string>("total_excess");
  const [querying, setQuerying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CountsResponse | null>(null);
  // View-only time window for histogram (does not affect API params)
  const [viewFromTime, setViewFromTime] = useState<string>("00:00");
  const [viewToTime, setViewToTime] = useState<string>("23:59");
  const [showRequest, setShowRequest] = useState<boolean>(false);
  const [showResponse, setShowResponse] = useState<boolean>(false);
  const [shockwaveHorizonMode, setShockwaveHorizonMode] = useState<string>("30");
  const [visibleMentionedTvCount, setVisibleMentionedTvCount] = useState<number>(TV_PAGE_SIZE);
  const [visibleTopTvCount, setVisibleTopTvCount] = useState<number>(TV_PAGE_SIZE);
  const [queriedBasketSignature, setQueriedBasketSignature] = useState<string | null>(null);

  const { hydrated, ready, user } = useResourceDateGuard();
  const basketRequestSignature = useMemo(
    () => JSON.stringify(basket.requestedCatalogIds),
    [basket.requestedCatalogIds],
  );
  const basketResultsStale = Boolean(
    data && queriedBasketSignature !== null && queriedBasketSignature !== basketRequestSignature,
  );

  const valid = useMemo(() => {
    const from = hhmmToSec(fromTime);
    const to = hhmmToSec(toTime);
    return to >= from; // inclusive window allowed by backend
  }, [fromTime, toTime]);

  const statusMessages = useMemo(() => {
    const messages: { tone: StatusTone; text: string }[] = [];
    if (!valid) messages.push({ tone: "danger", text: "End time must not be earlier than start time." });
    if (error) messages.push({ tone: "danger", text: error });
    if (basketResultsStale) {
      messages.push({ tone: "warning", text: "Basket changed. Run the query to refresh requested traffic volumes." });
    }
    if (basket.catalogLoading) messages.push({ tone: "muted", text: "Loading traffic-volume catalog…" });
    return messages;
  }, [basket.catalogLoading, basketResultsStale, error, valid]);

  const handleQuery = async () => {
    setError(null);
    setQuerying(true);
    setData(null);
    try {
      const payload = buildOriginalCountsRequest({
        requestedTrafficVolumeIds: basket.requestedCatalogIds,
        fromTime,
        toTime,
        rollingHour,
        rankBy,
      });
      const res = await (await import("@/lib/auth")).authFetch('/api/original_counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed: ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      setQueriedBasketSignature(basketRequestSignature);
      // After a successful query, align view window with request
      setViewFromTime(fromTime);
      setViewToTime(toTime);
    } catch (e: any) {
      setError(e?.message || 'Failed to query original counts');
    } finally {
      setQuerying(false);
    }
  };

  // Debug request payload (exactly what we'll POST)
  const debugPayload = useMemo(() => {
    return buildOriginalCountsRequest({
      requestedTrafficVolumeIds: basket.requestedCatalogIds,
      fromTime,
      toTime,
      rollingHour,
      rankBy,
    });
  }, [fromTime, toTime, rollingHour, basket.requestedCatalogIds, rankBy]);

  const mentionedItems = useMemo(() => {
    const mc = data?.mentioned_counts || {};
    const mcap = data?.mentioned_capacity || {};
    const cap = data?.capacity || {};
    const labels = data?.timebins?.labels || [];
    const requestOrder = new Map(
      basket.requestedCatalogIds.map((id, index) => [id.toLocaleUpperCase(), index]),
    );
    const ids = Object.keys(mc).sort((a, b) => {
      const ai = requestOrder.get(a.toLocaleUpperCase()) ?? Number.POSITIVE_INFINITY;
      const bi = requestOrder.get(b.toLocaleUpperCase()) ?? Number.POSITIVE_INFINITY;
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    });
    return ids.map((tv) => {
      const series = mc[tv] || [];
      const capacitySeries = (mcap[tv] ?? cap[tv]) || [];
      return { tvId: tv, series, labels, capacitySeries };
    });
  }, [basket.requestedCatalogIds, data]);

  const topItems = useMemo(() => {
    const counts = data?.counts || {};
    const capacity = data?.capacity || {};
    const labels = data?.timebins?.labels || [];
    const order = data?.metadata?.ranked_tv_ids;
    const ids = order && order.length > 0 ? order.filter((id) => counts[id]) : Object.keys(counts);
    return ids.map((tv) => ({ tvId: tv, series: counts[tv] || [], capacitySeries: capacity[tv] || [], labels }));
  }, [data]);

  const visibleMentionedItems = useMemo(
    () => mentionedItems.slice(0, visibleMentionedTvCount),
    [mentionedItems, visibleMentionedTvCount],
  );
  const visibleTopItems = useMemo(
    () => topItems.slice(0, visibleTopTvCount),
    [topItems, visibleTopTvCount],
  );

  const shockwaveCounts = useMemo<Record<string, number[]>>(() => {
    const next: Record<string, number[]> = {};

    const assignSeries = (seriesByTv?: Record<string, number[]>) => {
      Object.entries(seriesByTv || {}).forEach(([tvId, series]) => {
        if (!Array.isArray(series)) return;
        next[tvId] = series;
      });
    };

    assignSeries(data?.counts);
    assignSeries(data?.mentioned_counts);
    return next;
  }, [data]);

  const shockwaveTargetTime = useMemo(() => {
    if (shockwaveHorizonMode === "auto") {
      return viewToTime;
    }
    return formatMinutesToHHMMWith24(
      hhmmToMinutes(viewFromTime) + (Number(shockwaveHorizonMode) || 0),
    );
  }, [viewFromTime, viewToTime, shockwaveHorizonMode]);
  const shockwaveOffsetMinutes = useMemo(
    () => Math.max(0, hhmmToMinutes(shockwaveTargetTime) - hhmmToMinutes(viewFromTime)),
    [viewFromTime, shockwaveTargetTime],
  );
  const shockwaveHorizonLabel = useMemo(() => {
    if (shockwaveHorizonMode === "auto") return "Auto";
    return formatShockwaveHorizonLabel(Number(shockwaveHorizonMode) || 0);
  }, [shockwaveHorizonMode]);

  useEffect(() => {
    setVisibleMentionedTvCount(TV_PAGE_SIZE);
    setVisibleTopTvCount(TV_PAGE_SIZE);
  }, [data]);

  // Ensure hooks are always called before any early return
  if (!hydrated || !ready || !user) {
    return null;
  }

  return (
    <main key={resourceDate ?? "no-resource-date"} className="min-h-screen w-screen overflow-x-hidden analytics-surface relative">
      <Header />
      <div className="pt-16 pb-12 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6">
            <div className="text-[11px] uppercase tracking-wider text-white/70">Analytics</div>
            <h1 className="text-2xl font-semibold text-white">Occupancy Counts</h1>
          </div>

          {/* Controls */}
          <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
            {/* Traffic volume selection */}
            <div className="px-5 pt-5 pb-4">
              <GlobalTVBasket variant="plain" />
            </div>

            {/* Query parameters */}
            <div className="border-t border-white/10 px-5 py-4">
              <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                <label className="flex flex-col gap-1.5">
                  <FieldLabel>From</FieldLabel>
                  <input
                    type="time"
                    value={fromTime}
                    onChange={(e) => setFromTime(e.currentTarget.value)}
                    className={`${FIELD_CLASS} w-[8.5rem]`}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <FieldLabel>To</FieldLabel>
                  <input
                    type="time"
                    value={toTime}
                    onChange={(e) => setToTime(e.currentTarget.value)}
                    className={`${FIELD_CLASS} w-[8.5rem]`}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <FieldLabel>Rank by</FieldLabel>
                  <div className="relative">
                    <select
                      value={rankBy}
                      onChange={(e) => setRankBy(e.currentTarget.value)}
                      className={`${FIELD_CLASS} w-48 appearance-none pr-10`}
                    >
                      <option value="total_excess">Total Excess</option>
                      <option value="total_count">Total Count</option>
                    </select>
                    <SelectChevron />
                  </div>
                </label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={rollingHour}
                  onClick={() => setRollingHour((value) => !value)}
                  className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm transition ${
                    rollingHour
                      ? "border-sky-300/40 bg-sky-500/15 text-sky-100"
                      : "border-white/20 bg-white/10 text-white/70 hover:border-white/30 hover:text-white"
                  }`}
                >
                  <span
                    className={`inline-flex h-4 w-4 items-center justify-center rounded border transition ${
                      rollingHour ? "border-sky-300/60 bg-sky-400/80 text-slate-950" : "border-white/25"
                    }`}
                  >
                    {rollingHour && <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />}
                  </span>
                  Rolling hour
                </button>

                <button
                  onClick={handleQuery}
                  disabled={!valid || querying || basket.catalogLoading}
                  className={`ml-auto inline-flex h-10 items-center gap-2 rounded-lg px-5 text-sm font-semibold transition ${
                    querying
                      ? "bg-gradient-to-r from-blue-500 to-cyan-400 text-white opacity-80 cursor-wait"
                      : valid && !basket.catalogLoading
                        ? "bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-lg shadow-cyan-500/20 hover:from-blue-500 hover:to-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                        : "cursor-not-allowed border border-white/15 bg-white/5 text-white/40"
                  }`}
                >
                  {querying ? <ShimmeringText text="Querying…" /> : "Run query"}
                </button>
              </div>

              {statusMessages.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5">
                  {statusMessages.map((status) => (
                    <div
                      key={status.text}
                      className={`inline-flex items-center gap-2 text-xs ${STATUS_TONE_CLASS[status.tone]}`}
                    >
                      {status.tone === "muted" ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      )}
                      {status.text}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Histogram view control */}
            <div className="border-t border-white/10 px-5 py-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <div className="text-[11px] font-medium uppercase tracking-wider text-white/50">
                  Histogram view range
                </div>
                <div className="flex items-center gap-1">
                  <DebugToggle active={showRequest} onClick={() => setShowRequest((s) => !s)}>
                    Request
                  </DebugToggle>
                  <DebugToggle active={showResponse} onClick={() => setShowResponse((s) => !s)}>
                    Response
                  </DebugToggle>
                </div>
              </div>
              <TimeScaleControl
                time_from={viewFromTime}
                time_to={viewToTime}
                stepMinutes={data?.time_bin_minutes ?? 1}
                onCommit={(f, t) => { setViewFromTime(f); setViewToTime(t); }}
              />
              {showRequest && (
                <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/80">
                  {JSON.stringify(debugPayload, null, 2)}
                </pre>
              )}
              {showResponse && data && (
                <pre className="mt-3 max-h-72 overflow-auto rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/80">
                  {JSON.stringify(data, null, 2)}
                </pre>
              )}
            </div>
          </div>

          {data && (
            <section className="mb-8">
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-white/50">
                      Traffic Volume Shockwaves
                    </div>
                    <div className="mt-1 text-xs text-white/65">
                      Uses the start of the histogram view range as <span className="font-mono">T</span>.
                      Colors show <span className="font-mono">count(T+Δ) - count(T)</span>.
                    </div>
                    <div className="mt-1 text-[11px] text-white/50">
                      Comparing <span className="font-mono">{viewFromTime}</span> to{" "}
                      <span className="font-mono">{shockwaveTargetTime}</span> ({shockwaveHorizonLabel})
                    </div>
                  </div>
                  <label className="flex w-full flex-col gap-1.5 sm:w-40">
                    <FieldLabel>Horizon</FieldLabel>
                    <div className="relative">
                      <select
                        value={shockwaveHorizonMode}
                        onChange={(e) => setShockwaveHorizonMode(e.currentTarget.value)}
                        className={`${FIELD_CLASS} w-full appearance-none pr-10`}
                      >
                        {SHOCKWAVE_HORIZON_OPTIONS.map((option) => (
                          <option key={`shockwave-${option.value}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <SelectChevron />
                    </div>
                  </label>
                </div>
                <TrafficVolumeShockwaves
                  countsByTv={shockwaveCounts}
                  binMinutes={data?.time_bin_minutes ?? 15}
                  selectedTime={viewFromTime}
                  offsetMinutes={shockwaveOffsetMinutes}
                  labels={data?.timebins?.labels || []}
                  startBin={data?.timebins?.start_bin}
                  loading={querying}
                  emptyMessage="No traffic-volume counts available for the selected shockwave comparison."
                />
              </div>
            </section>
          )}

          {/* Mentioned TVs */}
          <section className="mb-8">
            <SectionHeading title="Mentioned Traffic Volumes" count={mentionedItems.length} />
            {data?.mentioned_counts && Object.keys(data.mentioned_counts).length > 0 ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4">
                  {visibleMentionedItems.map(({ tvId, series, labels, capacitySeries }) => (
                    <ChartCard
                      key={`m-${tvId}`}
                      tvId={tvId}
                      series={series}
                      capacitySeries={capacitySeries}
                      labels={labels}
                      minutesPerBin={data?.time_bin_minutes ?? 15}
                      showCapacity={rollingHour}
                      viewFromMin={Math.floor(hhmmToSec(viewFromTime) / 60)}
                      viewToMin={Math.floor(hhmmToSec(viewToTime) / 60)}
                      viewFromTime={viewFromTime}
                      viewToTime={viewToTime}
                    />
                  ))}
                </div>
                {mentionedItems.length > visibleMentionedItems.length && (
                  <ShowMoreButton
                    remaining={mentionedItems.length - visibleMentionedItems.length}
                    onClick={() => setVisibleMentionedTvCount((count) => Math.min(count + TV_PAGE_SIZE, mentionedItems.length))}
                  />
                )}
              </>
            ) : (
              <EmptyState>No specific traffic volumes selected.</EmptyState>
            )}
          </section>

          {/* Top TVs */}
          <section className="mb-4">
            <SectionHeading title="Top Traffic Volumes" count={topItems.length} />
            {data?.counts && Object.keys(data.counts).length > 0 ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4">
                  {visibleTopItems.map(({ tvId, series, labels, capacitySeries }) => (
                    <ChartCard
                      key={`t-${tvId}`}
                      tvId={tvId}
                      series={series}
                      capacitySeries={capacitySeries}
                      labels={labels}
                      minutesPerBin={data?.time_bin_minutes ?? 15}
                      showCapacity={rollingHour}
                      viewFromMin={Math.floor(hhmmToSec(viewFromTime) / 60)}
                      viewToMin={Math.floor(hhmmToSec(viewToTime) / 60)}
                      viewFromTime={viewFromTime}
                      viewToTime={viewToTime}
                    />
                  ))}
                </div>
                {topItems.length > visibleTopItems.length && (
                  <ShowMoreButton
                    remaining={topItems.length - visibleTopItems.length}
                    onClick={() => setVisibleTopTvCount((count) => Math.min(count + TV_PAGE_SIZE, topItems.length))}
                  />
                )}
              </>
            ) : (
              <EmptyState>No data yet — run a query to load occupancy counts.</EmptyState>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function ChartCard({ tvId, series, labels, minutesPerBin, capacitySeries = [], showCapacity = false, viewFromMin, viewToMin, viewFromTime, viewToTime }: { tvId: string; series: number[]; labels: string[]; minutesPerBin: number; capacitySeries?: number[]; showCapacity?: boolean; viewFromMin: number; viewToMin: number; viewFromTime: string; viewToTime: string }) {
  const hotspotSettings = useHotspotSettingsStore((state) => state.settings);
  const rows = useMemo(() => {
    const n = Math.min(series.length, labels.length);
    const arr = new Array(n).fill(0).map((_, i) => {
      const capacity = normalizeCapacity(capacitySeries[i]);
      const label = String(labels[i] || "");
      // Try to parse start HH:MM from label; accept formats like "HH:MM" or "HH:MM-HH:MM"
      let startLabel = label;
      const dashIdx = label.indexOf("-");
      if (dashIdx > 0) startLabel = label.slice(0, dashIdx);
      const parsed = hhmmToMinutes(startLabel);
      const startMin = Number.isFinite(parsed) ? parsed : i * minutesPerBin;
      return { idx: i, value: Number(series[i] ?? 0), capacity, startMin };
    });
    // Filter by view window
    const vFrom = Math.max(0, Math.floor(viewFromMin));
    const vTo = Math.min(24 * 60 - 1, Math.floor(viewToMin));
    return arr.filter((r) => r.startMin >= vFrom && r.startMin <= vTo);
  }, [series, labels, capacitySeries, minutesPerBin, viewFromMin, viewToMin]);

  const overloadSegments = useMemo(() => {
    const segments: TrafficOverloadDatum[] = [];
    const binMinutes = Math.max(1, minutesPerBin);
    rows.forEach((row) => {
      if (row.capacity == null) return;
      const capacity = Number(row.capacity);
      const occupancy = Number(row.value);
      if (!Number.isFinite(capacity) || !Number.isFinite(occupancy)) return;
      const color = resolveHotspotColor({
        traffic_volume_id: tvId,
        hourly_occupancy: occupancy,
        hourly_capacity: capacity,
      }, hotspotSettings);
      if (!color) return;
      const startMinutes = row.startMin;
      const endMinutes = startMinutes + binMinutes;
      const startLabel = formatMinutesToHHMM(startMinutes);
      const endLabel = formatMinutesToHHMMWith24(endMinutes);
      segments.push({
        period: `${startLabel}-${endLabel}`,
        color,
        metadata: [
          `Count: ${occupancy.toFixed(0)}`,
          `Capacity: ${capacity.toFixed(0)}`,
          `Excess: ${(occupancy - capacity).toFixed(0)}`,
        ],
        label: `${tvId} overload`,
      });
    });
    return segments;
  }, [hotspotSettings, rows, minutesPerBin, tvId]);

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-white truncate">
          <TrafficVolumeInfoTooltip trafficVolumeId={tvId} className="truncate max-w-full">
            <span className="truncate">{tvId}</span>
          </TrafficVolumeInfoTooltip>
        </div>
      </div>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 6, left: 0, bottom: 16 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
            <XAxis
              dataKey="idx"
              tick={{ fontSize: 10 }}
              axisLine={true}
              tickLine={true}
              interval="preserveStartEnd"
              tickFormatter={(value: any) => {
                const idx = Number(value ?? 0);
                const l = labels[idx] || '';
                return l || binIndexToRangeLabel(idx, minutesPerBin);
              }}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              axisLine={true}
              tickLine={true}
              allowDecimals={false}
              width={32}
            />
            <Tooltip
              wrapperStyle={{ zIndex: 9999 }}
              contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "white" }}
              formatter={(value: any, name: any) => [String(value), name === 'capacity' ? 'Capacity' : 'Count']}
              labelFormatter={(labelIdx: any) => {
                const idx = Number(labelIdx ?? 0);
                const l = labels[idx] || '';
                return l || binIndexToRangeLabel(idx, minutesPerBin);
              }}
            />
            <Bar dataKey="value" fill="#60a5fa" />
            {showCapacity && (
              <Line type="stepAfter" dataKey="capacity" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4">
        <TrafficOverloadBar
          fromTime={viewFromTime}
          toTime={viewToTime}
          data={overloadSegments}
          showTime={overloadSegments.length > 0}
          showOkWhenNoData={false}
        />
      </div>

    </div>
  );
}

function hhmmToSec(hhmm: string): number {
  const [h, m] = (hhmm || '').split(":").map((x) => Number(x));
  const hh = Number.isFinite(h) ? h : 0;
  const mm = Number.isFinite(m) ? m : 0;
  return Math.max(0, hh * 3600 + mm * 60);
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = (hhmm || '').split(":").map((x) => Number(x));
  const hh = Number.isFinite(h) ? h : NaN;
  const mm = Number.isFinite(m) ? m : NaN;
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  const total = hh * 60 + mm;
  return Math.max(0, Math.min(24 * 60 - 1, total));
}

function formatMinutesToHHMM(totalMinutes: number): string {
  const minutesInDay = 24 * 60;
  const m = ((Math.floor(totalMinutes) % minutesInDay) + minutesInDay) % minutesInDay;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function formatMinutesToHHMMWith24(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes)) return "00:00";
  const clamped = Math.max(0, Math.floor(totalMinutes));
  if (clamped >= 24 * 60) {
    return "24:00";
  }
  return formatMinutesToHHMM(clamped);
}

function binIndexToRangeLabel(binIdx: number, minutesPerBin: number): string {
  const startMin = binIdx * minutesPerBin;
  const endMin = startMin + minutesPerBin;
  return `${formatMinutesToHHMM(startMin)}-${formatMinutesToHHMMWith24(endMin)}`;
}
