"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import ShimmeringText from "@/components/ShimmeringText";
import { useSimStore } from "@/components/useSimStore";
import { authFetch } from "@/lib/auth";
import {
  buildCollapsedSectorDdHotspotsPath,
  COMPLEXITY_METRIC_IDS,
  getComplexityMetricSelectionLabel,
  type ComplexityHotspot,
  type ComplexityHotspotsResponse,
  type ComplexityMetricId,
} from "@/lib/csComplexity";
import { loadSectors } from "@/lib/airspace";
import { normalizeCollapsedSectors } from "@/lib/airspaceDisplay";
import { getResourcePathsForDate } from "@/lib/dataPaths";
import { formatSeeMoreLabel, SEE_LESS_LABEL } from "@/lib/seeMoreLess";
import type { SectorFeatureProps } from "@/lib/models";

const DEFAULT_METRIC_ID: ComplexityMetricId = "td";
const DEFAULT_THRESHOLD = 0.05;
const MAX_VISIBLE_COMPLEX_SPOTS = 20;

type ComplexSpotSortKey = "cs" | "time" | "prob" | "peak" | "mean";

type CollapsedSectorFeature = GeoJSON.Feature<
  GeoJSON.Geometry | null,
  SectorFeatureProps & Record<string, unknown>
>;

function parseTimeToSeconds(timeStr: string): number {
  const [hoursRaw, minutesRaw, secondsRaw] = String(timeStr ?? "").trim().split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  const seconds = Number(secondsRaw ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return 0;
  return hours * 3600 + minutes * 60 + seconds;
}

function formatTailProbability(value: number | null | undefined): string {
  const next = Number(value);
  if (!Number.isFinite(next)) return "—";
  if (next < 0.001) return "<0.001";
  return next.toFixed(3);
}

function formatObservedValue(value: number | null | undefined): string {
  const next = Number(value);
  if (!Number.isFinite(next)) return "—";
  if (Math.abs(next) >= 100 || Number.isInteger(next)) return String(Math.round(next));
  return next.toFixed(1);
}

function getProbabilityTone(value: number | null | undefined): string {
  const next = Number(value);
  if (!Number.isFinite(next)) return "text-white/55";
  if (next <= 0.01) return "text-red-200";
  if (next <= 0.05) return "text-orange-200";
  if (next <= 0.1) return "text-yellow-100";
  return "text-white/80";
}

function getComplexSpotStartLabel(hotspot: ComplexityHotspot): string {
  if (typeof hotspot.start_label === "string" && hotspot.start_label.trim()) {
    return hotspot.start_label.trim();
  }
  const [start] = String(hotspot.time_bin ?? "").split("-");
  return String(start ?? "").trim();
}

function getComplexSpotEndLabel(hotspot: ComplexityHotspot): string {
  if (typeof hotspot.end_label === "string" && hotspot.end_label.trim()) {
    return hotspot.end_label.trim();
  }
  const [, end] = String(hotspot.time_bin ?? "").split("-");
  return String(end ?? "").trim();
}

function getDefaultSortDirection(key: ComplexSpotSortKey): "asc" | "desc" {
  if (key === "peak" || key === "mean") return "desc";
  return "asc";
}

function getNumericSortValue(
  hotspot: ComplexityHotspot,
  key: Extract<ComplexSpotSortKey, "prob" | "peak" | "mean">,
): number {
  switch (key) {
    case "prob": {
      const value = Number(hotspot.min_upper_tail_probability);
      return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
    }
    case "peak": {
      const value = Number(hotspot.peak_observed_value);
      return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
    }
    case "mean": {
      const value = Number(hotspot.worst_bin_expected_mean);
      return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
    }
  }
}

type CSComplexSpotsLeftPanelProps = {
  embedded?: boolean;
};

export default function CSComplexSpotsLeftPanel({
  embedded = false,
}: CSComplexSpotsLeftPanelProps) {
  const {
    resourceDate,
    resourceStateEpoch,
    setAirspaceDisplayMode,
    setSelectedCollapsedSector,
    setT,
  } = useSimStore();

  const [showComplexSpots, setShowComplexSpots] = useState(true);
  const [selectedMetricId, setSelectedMetricId] = useState<ComplexityMetricId>(DEFAULT_METRIC_ID);
  const [complexSpots, setComplexSpots] = useState<ComplexityHotspot[]>([]);
  const [complexSpotsLoading, setComplexSpotsLoading] = useState(false);
  const [complexSpotsError, setComplexSpotsError] = useState<string | null>(null);
  const [showAllComplexSpots, setShowAllComplexSpots] = useState(false);
  const [collapsedSectorSearch, setCollapsedSectorSearch] = useState("");
  const [sortBy, setSortBy] = useState<ComplexSpotSortKey>("prob");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [collapsedSectorLookup, setCollapsedSectorLookup] = useState<Map<string, CollapsedSectorFeature>>(
    () => new Map(),
  );
  const requestSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;

    if (!resourceDate) {
      setCollapsedSectorLookup(new Map());
      return () => {
        cancelled = true;
      };
    }

    const loadCollapsedSectorLookup = async () => {
      try {
        const resourcePaths = getResourcePathsForDate(resourceDate);
        const rawCollection = await loadSectors(resourcePaths.collapsedSectorsGeojson);
        if (cancelled) return;
        const normalized = normalizeCollapsedSectors(rawCollection);
        const nextLookup = new Map<string, CollapsedSectorFeature>();
        for (const feature of normalized.collection.features) {
          const sectorId = String(
            feature?.properties?.traffic_volume_id ?? feature?.properties?.collapsed_sector ?? "",
          ).trim();
          if (!sectorId) continue;
          nextLookup.set(sectorId, feature as CollapsedSectorFeature);
        }
        setCollapsedSectorLookup(nextLookup);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load collapsed sector lookup:", error);
          setCollapsedSectorLookup(new Map());
        }
      }
    };

    loadCollapsedSectorLookup();
    return () => {
      cancelled = true;
    };
  }, [resourceDate]);

  useEffect(() => {
    setShowAllComplexSpots(false);
  }, [collapsedSectorSearch, resourceStateEpoch, selectedMetricId]);

  useEffect(() => {
    if (!showComplexSpots) {
      setComplexSpotsLoading(false);
      setComplexSpotsError(null);
      return;
    }

    let cancelled = false;
    const requestId = ++requestSeq.current;
    setComplexSpotsLoading(true);
    setComplexSpotsError(null);

    authFetch(
      buildCollapsedSectorDdHotspotsPath({
        metricId: selectedMetricId,
        threshold: DEFAULT_THRESHOLD,
      }),
    )
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const errorMessage =
            typeof payload?.error === "string" && payload.error.trim()
              ? payload.error
              : "Failed to fetch complex spots";
          throw new Error(errorMessage);
        }
        return response.json() as Promise<ComplexityHotspotsResponse>;
      })
      .then((payload) => {
        if (cancelled || requestId !== requestSeq.current) return;
        setComplexSpots(Array.isArray(payload.hotspots) ? payload.hotspots : []);
      })
      .catch((error) => {
        if (cancelled || requestId !== requestSeq.current) return;
        setComplexSpots([]);
        setComplexSpotsError(error instanceof Error ? error.message : "Failed to fetch complex spots");
      })
      .finally(() => {
        if (cancelled || requestId !== requestSeq.current) return;
        setComplexSpotsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshNonce, resourceStateEpoch, selectedMetricId, showComplexSpots]);

  const sortedComplexSpots = useMemo(() => {
    const list = [...complexSpots];
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((left, right) => {
      if (sortBy === "cs") {
        return String(left.collapsed_sector_id ?? "").localeCompare(String(right.collapsed_sector_id ?? "")) * dir;
      }
      if (sortBy === "time") {
        return (
          (parseTimeToSeconds(getComplexSpotStartLabel(left)) - parseTimeToSeconds(getComplexSpotStartLabel(right))) *
          dir
        );
      }
      const leftValue = getNumericSortValue(left, sortBy);
      const rightValue = getNumericSortValue(right, sortBy);
      if (leftValue < rightValue) return -1 * dir;
      if (leftValue > rightValue) return 1 * dir;
      const sectorCmp = String(left.collapsed_sector_id ?? "").localeCompare(String(right.collapsed_sector_id ?? ""));
      if (sectorCmp !== 0) return sectorCmp;
      return parseTimeToSeconds(getComplexSpotStartLabel(left)) - parseTimeToSeconds(getComplexSpotStartLabel(right));
    });
    return list;
  }, [complexSpots, sortBy, sortDir]);

  const filteredComplexSpots = useMemo(() => {
    const pattern = collapsedSectorSearch.trim();
    if (!pattern) return sortedComplexSpots;
    if (pattern.includes("*") || pattern.includes("?")) {
      const regex = new RegExp(
        `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`,
        "i",
      );
      return sortedComplexSpots.filter((hotspot) => regex.test(String(hotspot.collapsed_sector_id ?? "")));
    }
    const lower = pattern.toLowerCase();
    return sortedComplexSpots.filter((hotspot) =>
      String(hotspot.collapsed_sector_id ?? "").toLowerCase().includes(lower),
    );
  }, [collapsedSectorSearch, sortedComplexSpots]);

  const visibleComplexSpots = useMemo(() => {
    if (showAllComplexSpots) return filteredComplexSpots;
    return filteredComplexSpots.slice(0, MAX_VISIBLE_COMPLEX_SPOTS);
  }, [filteredComplexSpots, showAllComplexSpots]);

  const hiddenComplexSpotCount = Math.max(0, filteredComplexSpots.length - visibleComplexSpots.length);

  const handleHeaderClick = (key: ComplexSpotSortKey) => {
    if (key === sortBy) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(key);
    setSortDir(getDefaultSortDirection(key));
  };

  const handleComplexSpotRowClick = (hotspot: ComplexityHotspot) => {
    const collapsedSectorId = String(hotspot.collapsed_sector_id ?? "").trim();
    if (!collapsedSectorId) return;
    const startSeconds = parseTimeToSeconds(getComplexSpotStartLabel(hotspot));
    const feature = collapsedSectorLookup.get(collapsedSectorId);
    const sectorData = feature?.properties
      ? { properties: feature.properties as SectorFeatureProps }
      : null;

    setT(startSeconds);
    setAirspaceDisplayMode("es");
    setSelectedCollapsedSector(collapsedSectorId, sectorData);

    window.dispatchEvent(
      new CustomEvent("traffic-volume-search-select", {
        detail: {
          trafficVolume: feature,
          trafficVolumeId: collapsedSectorId,
          selectionApplied: true,
        },
      }),
    );
  };

  const panelClassName = embedded
    ? "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col"
    : "w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white flex flex-col overflow-hidden";

  return (
    <div className={panelClassName}>
      <div className={embedded ? "p-4 space-y-4" : "overflow-y-auto no-scrollbar p-4 space-y-4 flex-1"}>
        <div className="bg-white/5 rounded-lg p-4">
          <h2 className="font-semibold mb-3">Complex Spots</h2>

          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => setRefreshNonce((current) => current + 1)}
              disabled={complexSpotsLoading}
              className={`p-1.5 rounded-lg border border-white/30 bg-white/20 hover:bg-white/30 text-sm transition-opacity ${
                complexSpotsLoading ? "opacity-50 cursor-not-allowed" : ""
              }`}
              title="Refresh Complex Spots"
            >
              <svg className={`w-4 h-4 ${complexSpotsLoading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>

            <div className="flex items-center justify-between flex-1">
              <label className="text-sm">Show Complex Spots</label>
              <button
                type="button"
                role="switch"
                aria-checked={showComplexSpots}
                aria-label={showComplexSpots ? "Hide complex spots" : "Show complex spots"}
                onClick={() => setShowComplexSpots((current) => !current)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                  showComplexSpots
                    ? "border-emerald-200/70 bg-emerald-400/80 hover:bg-emerald-400/90"
                    : "border-white/30 bg-white/20 hover:bg-white/30"
                }`}
              >
                <span className="sr-only">{showComplexSpots ? "Disable complex spots" : "Enable complex spots"}</span>
                <span
                  aria-hidden="true"
                  className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
                    showComplexSpots ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {showComplexSpots && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <label className="text-xs text-white/70 whitespace-nowrap" htmlFor="complex-spot-metric">
                  Rank by
                </label>
                <div className="relative flex-1">
                  <select
                    id="complex-spot-metric"
                    value={selectedMetricId}
                    onChange={(event) => setSelectedMetricId(event.currentTarget.value as ComplexityMetricId)}
                    className="w-full appearance-none rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 pr-8 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/30"
                    aria-label="Choose complexity metric for ranking complex spots"
                  >
                    {COMPLEXITY_METRIC_IDS.map((metricId) => (
                      <option key={metricId} value={metricId} className="bg-slate-800 text-white">
                        {getComplexityMetricSelectionLabel(metricId)}
                      </option>
                    ))}
                  </select>
                  <svg className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.25 8.29a.75.75 0 01-.02-1.08z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 text-[11px] text-white/60">
                <span>Upper-tail probability ≤ {DEFAULT_THRESHOLD.toFixed(2)}</span>
                <span>{filteredComplexSpots.length} listed</span>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 opacity-40 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                  </svg>
                  <input
                    type="search"
                    value={collapsedSectorSearch}
                    onChange={(event) => {
                      setCollapsedSectorSearch(event.target.value);
                      setShowAllComplexSpots(false);
                    }}
                    placeholder="Filter by CS id (EG*...)"
                    className="w-full pl-6 pr-2 py-0.5 text-xs rounded-lg border border-white/20 bg-white/10 placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-white/30"
                    aria-label="Filter complex spots by collapsed sector id"
                  />
                </div>
                {complexSpotsLoading && (
                  <div className="flex items-center shrink-0">
                    <div className="animate-spin rounded-full h-3 w-3 border border-white/25 border-t-white" />
                    <ShimmeringText text="Loading..." className="ml-1 text-xs opacity-70 font-normal" />
                  </div>
                )}
              </div>

              {complexSpotsError ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/20 p-3">
                  <p className="text-xs text-red-200">{complexSpotsError}</p>
                </div>
              ) : complexSpots.length > 0 && !complexSpotsLoading ? (
                filteredComplexSpots.length === 0 ? (
                  <p className="text-xs opacity-70 text-center py-4">
                    No complex spots match &ldquo;{collapsedSectorSearch}&rdquo;
                  </p>
                ) : (
                  <div className="rounded-lg border border-white/10 overflow-hidden">
                    <div className={embedded ? "overflow-x-auto" : "max-h-60 overflow-y-auto no-scrollbar overflow-x-auto"}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-white/10 select-none">
                            <SortableTh label="CS" active={sortBy === "cs"} dir={sortDir} onClick={() => handleHeaderClick("cs")} />
                            <SortableTh label="Time" active={sortBy === "time"} dir={sortDir} onClick={() => handleHeaderClick("time")} />
                            <SortableTh label="p↑" active={sortBy === "prob"} dir={sortDir} onClick={() => handleHeaderClick("prob")} />
                            <SortableTh label="Obs." active={sortBy === "peak"} dir={sortDir} onClick={() => handleHeaderClick("peak")} />
                            <SortableTh label="Exp." active={sortBy === "mean"} dir={sortDir} onClick={() => handleHeaderClick("mean")} />
                          </tr>
                        </thead>
                        <tbody>
                          {visibleComplexSpots.map((hotspot, index) => {
                            const rowKey = `${hotspot.collapsed_sector_id}-${hotspot.time_bin}-${hotspot.metric_id}`;
                            const zebraClass = index % 2 === 0 ? "bg-white/0" : "bg-white/5";
                            const startLabel = getComplexSpotStartLabel(hotspot);
                            const endLabel = getComplexSpotEndLabel(hotspot);
                            return (
                              <Fragment key={rowKey}>
                                <tr
                                  className={`border-t border-white/10 ${zebraClass} hover:bg-white/10 cursor-pointer transition-colors`}
                                  onClick={() => handleComplexSpotRowClick(hotspot)}
                                  title="Click to jump to the time window and select this collapsed sector"
                                >
                                  <td className="p-2 font-mono text-xs">{hotspot.collapsed_sector_id}</td>
                                  <td className="p-2 font-mono text-xs leading-tight">
                                    <div>{startLabel || "—"}</div>
                                    <div>{endLabel || "—"}</div>
                                  </td>
                                  <td className={`p-2 text-right font-mono ${getProbabilityTone(hotspot.min_upper_tail_probability)}`}>
                                    {formatTailProbability(hotspot.min_upper_tail_probability)}
                                  </td>
                                  <td className="p-2 text-right font-mono">
                                    {formatObservedValue(hotspot.peak_observed_value)}
                                  </td>
                                  <td className="p-2 text-right font-mono">
                                    {formatObservedValue(hotspot.worst_bin_expected_mean)}
                                  </td>
                                </tr>
                              </Fragment>
                            );
                          })}
                          {!showAllComplexSpots && filteredComplexSpots.length > MAX_VISIBLE_COMPLEX_SPOTS && (
                            <tr
                              className="border-t border-white/10 hover:bg-white/10 cursor-pointer transition-colors"
                              onClick={() => setShowAllComplexSpots(true)}
                              title="Show the remaining complex spots"
                            >
                              <td className="p-2 text-center italic opacity-80" colSpan={5}>
                                {formatSeeMoreLabel(hiddenComplexSpotCount)}
                              </td>
                            </tr>
                          )}
                          {showAllComplexSpots && filteredComplexSpots.length > MAX_VISIBLE_COMPLEX_SPOTS && (
                            <tr
                              className="border-t border-white/10 hover:bg-white/10 cursor-pointer transition-colors"
                              onClick={() => setShowAllComplexSpots(false)}
                              title="Collapse the list"
                            >
                              <td className="p-2 text-center italic opacity-80" colSpan={5}>
                                {SEE_LESS_LABEL}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              ) : !complexSpotsLoading ? (
                <p className="text-xs opacity-70 text-center py-4">No complex spots found</p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type SortableThProps = {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
};

function SortableTh({ label, active, dir, onClick }: SortableThProps) {
  return (
    <th className="text-left p-2 font-semibold">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 cursor-pointer select-none focus:outline-none focus:ring-1 focus:ring-white/40 rounded"
        aria-pressed={active}
        title={`Sort by ${label} (${dir === "asc" ? "ascending" : "descending"})`}
      >
        <span>{label}</span>
        <svg
          className={`w-3 h-3 transition-transform ${active ? "opacity-100" : "opacity-0"} ${active && dir === "asc" ? "transform rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
        >
          <path d="M19 9l-7 7-7-7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </th>
  );
}
