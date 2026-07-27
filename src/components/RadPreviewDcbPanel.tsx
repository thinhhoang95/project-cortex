"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

import ShimmeringText from "@/components/ShimmeringText";
import TrafficOverloadBar from "@/components/TrafficOverloadBar";
import TrafficVolumeInfoTooltip from "@/components/TrafficVolumeInfoTooltip";
import { useSimStore } from "@/components/useSimStore";
import { formatSeeMoreLabel, SEE_LESS_LABEL } from "@/lib/seeMoreLess";
import { addMinutesToHHMM } from "@/lib/time";
import { resolveHotspotColor } from "@/lib/hotspotColoring";

type RadPreviewDcbPanelProps = {
  embedded?: boolean;
};

type SortKey = "tv" | "time" | "occ" | "cap" | "ex";

export default function RadPreviewDcbPanel({ embedded = false }: RadPreviewDcbPanelProps) {
  const {
    showHotspots,
    setShowHotspots,
    fetchHotspots,
    hotspotsLoading,
    hotspots,
    hotspotsMetadata,
    setT,
    setSelectedTrafficVolume,
    resourceStateEpoch,
  } = useSimStore();

  const [sortBy, setSortBy] = useState<SortKey>("ex");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showAllHotspots, setShowAllHotspots] = useState(false);
  const [tvSearch, setTvSearch] = useState("");

  useEffect(() => {
    if (showHotspots) {
      fetchHotspots();
    }
  }, [fetchHotspots, resourceStateEpoch, showHotspots]);

  const sortedHotspots = useMemo(() => {
    const list = [...hotspots];
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a: any, b: any) => {
      let av: string | number = 0;
      let bv: string | number = 0;

      switch (sortBy) {
        case "tv":
          av = String(a.traffic_volume_id || "");
          bv = String(b.traffic_volume_id || "");
          return (av as string).localeCompare(bv as string) * dir;
        case "time": {
          const [aStart] = String(a.time_bin || "").split("-");
          const [bStart] = String(b.time_bin || "").split("-");
          av = parseTimeToSeconds(aStart || "00:00");
          bv = parseTimeToSeconds(bStart || "00:00");
          break;
        }
        case "occ":
          av = Number(a.hourly_occupancy || 0);
          bv = Number(b.hourly_occupancy || 0);
          break;
        case "cap":
          av = Number(a.hourly_capacity || 0);
          bv = Number(b.hourly_capacity || 0);
          break;
        case "ex":
          av = Number(a.hourly_occupancy || 0) - Number(a.hourly_capacity || 0);
          bv = Number(b.hourly_occupancy || 0) - Number(b.hourly_capacity || 0);
          break;
      }

      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;

      const tvCmp = String(a.traffic_volume_id || "").localeCompare(String(b.traffic_volume_id || ""));
      if (tvCmp !== 0) return tvCmp;
      const [aStart] = String(a.time_bin || "").split("-");
      const [bStart] = String(b.time_bin || "").split("-");
      return parseTimeToSeconds(aStart || "00:00") - parseTimeToSeconds(bStart || "00:00");
    });
    return list;
  }, [hotspots, sortBy, sortDir]);

  const filteredHotspots = useMemo(() => {
    const pattern = tvSearch.trim();
    if (!pattern) return sortedHotspots;
    if (pattern.includes("*") || pattern.includes("?")) {
      const regex = new RegExp(
        `^${pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".")}$`,
        "i",
      );
      return sortedHotspots.filter((hotspot: any) => regex.test(String(hotspot.traffic_volume_id ?? "")));
    }
    const lower = pattern.toLowerCase();
    return sortedHotspots.filter((hotspot: any) =>
      String(hotspot.traffic_volume_id ?? "").toLowerCase().includes(lower),
    );
  }, [sortedHotspots, tvSearch]);

  const displayedHotspots = useMemo(
    () => (showAllHotspots ? filteredHotspots : filteredHotspots.slice(0, 20)),
    [filteredHotspots, showAllHotspots],
  );
  const hiddenHotspotCount = Math.max(0, filteredHotspots.length - displayedHotspots.length);
  const hotspotBinMinutesRaw = Number(hotspotsMetadata?.time_bin_minutes);
  const hotspotBinMinutes =
    Number.isFinite(hotspotBinMinutesRaw) && hotspotBinMinutesRaw > 0 ? hotspotBinMinutesRaw : null;

  const handleHeaderClick = (key: SortKey) => {
    if (key === sortBy) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(key);
    setSortDir("asc");
  };

  const handleHotspotRowClick = (hotspot: any) => {
    const [startTime] = String(hotspot.time_bin || "").split("-");
    const startSeconds = parseTimeToSeconds(startTime || "00:00");
    setT(startSeconds);
    setSelectedTrafficVolume(String(hotspot.traffic_volume_id ?? ""), null);
    window.dispatchEvent(
      new CustomEvent("traffic-volume-search-select", {
        detail: { trafficVolumeId: hotspot.traffic_volume_id, selectionApplied: true },
      }),
    );
  };

  return (
    <div
      className={
        embedded
          ? "w-full rounded-2xl border border-white/20 bg-white/20 text-white shadow-xl backdrop-blur-md"
          : "w-full rounded-2xl border border-white/20 bg-white/20 text-white shadow-xl backdrop-blur-md"
      }
    >
      <div className="flex h-full flex-col p-4">
        <div className="bg-white/5 rounded-lg p-4">
          <h2 className="mb-3 font-semibold">Demand Capacity Balancing</h2>

          <div className="mb-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchHotspots()}
              disabled={hotspotsLoading}
              className={`rounded-lg border border-white/30 bg-white/20 p-1.5 text-sm transition-opacity ${
                hotspotsLoading ? "cursor-not-allowed opacity-50" : "hover:bg-white/30"
              }`}
              title="Refresh hotspots"
            >
              <svg
                className={`h-4 w-4 ${hotspotsLoading ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>

            <div className="flex flex-1 items-center justify-between">
              <label className="text-sm">Show Hotspots</label>
              <button
                type="button"
                role="switch"
                aria-checked={showHotspots}
                aria-label={showHotspots ? "Hide hotspots" : "Show hotspots"}
                onClick={() => setShowHotspots(!showHotspots)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                  showHotspots
                    ? "border-emerald-200/70 bg-emerald-400/80 hover:bg-emerald-400/90"
                    : "border-white/30 bg-white/20 hover:bg-white/30"
                }`}
              >
                <span className="sr-only">{showHotspots ? "Disable hotspots" : "Enable hotspots"}</span>
                <span
                  aria-hidden="true"
                  className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
                    showHotspots ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {showHotspots && (
            <div className="flex flex-col">
              <div className="mb-2 flex items-center gap-2">
                <div className="relative flex-1">
                  <svg
                    className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 opacity-40"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
                    />
                  </svg>
                  <input
                    type="search"
                    value={tvSearch}
                    onChange={(event) => {
                      setTvSearch(event.target.value);
                      setShowAllHotspots(false);
                    }}
                    placeholder="Filter by TV name (EG*...)"
                    className="w-full rounded-lg border border-white/20 bg-white/10 py-0.5 pl-6 pr-2 text-xs placeholder-white/30 focus:outline-none focus:ring-1 focus:ring-white/30"
                    aria-label="Filter hotspots by traffic volume name"
                  />
                </div>
                {hotspotsLoading && (
                  <div className="flex shrink-0 items-center">
                    <div className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white/90" />
                    <ShimmeringText text="Loading..." className="ml-1 text-xs font-normal opacity-70" />
                  </div>
                )}
              </div>

              {hotspots.length > 0 && !hotspotsLoading ? (
                filteredHotspots.length === 0 ? (
                  <p className="py-4 text-center text-xs opacity-70">No hotspots match &ldquo;{tvSearch}&rdquo;</p>
                ) : (
                  <div className={`overflow-hidden rounded-lg border border-white/10 ${embedded ? "" : "max-h-[320px]"}`}>
                    <div className={embedded ? "overflow-x-auto" : "overflow-x-auto overflow-y-auto no-scrollbar"}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="select-none bg-white/10">
                            <SortableTh label="TV" active={sortBy === "tv"} dir={sortDir} onClick={() => handleHeaderClick("tv")} />
                            <SortableTh label="Time" active={sortBy === "time"} dir={sortDir} onClick={() => handleHeaderClick("time")} />
                            <th className="p-2 text-left font-semibold">Ovl.</th>
                            <SortableTh label="Ex." active={sortBy === "ex"} dir={sortDir} onClick={() => handleHeaderClick("ex")} />
                          </tr>
                        </thead>
                        <tbody>
                          {displayedHotspots.map((hotspot, index) => {
                            const [fromRaw, toRaw] = String(hotspot.time_bin || "").split("-");
                            const from = (fromRaw ?? "").trim();
                            const toStart = (toRaw ?? "").trim();
                            const to =
                              toStart && hotspotBinMinutes !== null
                                ? addMinutesToHHMM(toStart, hotspotBinMinutes)
                                : toStart;
                            const occupancy = Number(hotspot.hourly_occupancy ?? 0);
                            const capacity = Number(hotspot.hourly_capacity ?? 0);
                            const excess = occupancy - capacity;
                            const severityColor = resolveHotspotColor(hotspot) ?? "#34d399";
                            const metadata: string[] = [
                              `Occupancy: ${occupancy.toFixed(0)}`,
                              `Capacity: ${capacity.toFixed(0)}`,
                              `Excess: ${excess.toFixed(0)}`,
                            ];
                            if (Number.isFinite(hotspot.z_max)) {
                              metadata.push(`Peak load: ${Number(hotspot.z_max).toFixed(2)}`);
                            }
                            if (Number.isFinite(hotspot.z_sum)) {
                              metadata.push(`Load sum: ${Number(hotspot.z_sum).toFixed(2)}`);
                            }
                            const rowKey = `${hotspot.traffic_volume_id}-${hotspot.time_bin}`;
                            const zebraClass = index % 2 === 0 ? "bg-white/0" : "bg-white/5";

                            return (
                              <Fragment key={rowKey}>
                                <TrafficVolumeInfoTooltip
                                  trafficVolumeId={String(hotspot.traffic_volume_id ?? "")}
                                  asChild
                                >
                                  <tr
                                    className={`cursor-pointer border-t border-white/10 transition-colors ${zebraClass} hover:bg-white/10`}
                                    onClick={() => handleHotspotRowClick(hotspot)}
                                    title="Click to set time and focus this traffic volume"
                                  >
                                    <td className="p-2 font-mono text-xs">{hotspot.traffic_volume_id}</td>
                                    <td className="p-2 font-mono text-xs leading-tight">
                                      <div>{from}</div>
                                      <div>{to}</div>
                                    </td>
                                    <td className="p-2">
                                      <TrafficOverloadBar
                                        fromTime="00:00"
                                        toTime="24:00"
                                        data={[
                                          {
                                            period: String(hotspot.time_bin || ""),
                                            color: severityColor,
                                            metadata,
                                            label: `${hotspot.traffic_volume_id} hotspot`,
                                          },
                                        ]}
                                      />
                                    </td>
                                    <td className="p-2 text-right font-mono">{excess.toFixed(0)}</td>
                                  </tr>
                                </TrafficVolumeInfoTooltip>
                              </Fragment>
                            );
                          })}
                          {!showAllHotspots && filteredHotspots.length > 20 && (
                            <tr
                              className="cursor-pointer border-t border-white/10 transition-colors hover:bg-white/10"
                              onClick={() => setShowAllHotspots(true)}
                              title="Show remaining hotspots"
                            >
                              <td className="p-2 text-center italic opacity-80" colSpan={4}>
                                {formatSeeMoreLabel(hiddenHotspotCount)}
                              </td>
                            </tr>
                          )}
                          {showAllHotspots && filteredHotspots.length > 20 && (
                            <tr
                              className="cursor-pointer border-t border-white/10 transition-colors hover:bg-white/10"
                              onClick={() => setShowAllHotspots(false)}
                              title="Collapse hotspot list"
                            >
                              <td className="p-2 text-center italic opacity-80" colSpan={4}>
                                {SEE_LESS_LABEL}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              ) : !hotspotsLoading ? (
                <p className="py-4 text-center text-xs opacity-70">No hotspots found</p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function parseTimeToSeconds(timeStr: string): number {
  const [hours, minutes] = String(timeStr ?? "00:00").split(":").map(Number);
  return hours * 3600 + minutes * 60;
}

type SortableThProps = {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
};

function SortableTh({ label, active, dir, onClick }: SortableThProps) {
  return (
    <th className="p-2 text-left font-semibold">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 rounded focus:outline-none focus:ring-1 focus:ring-white/40"
        aria-pressed={active}
        title={`Sort by ${label} (${dir === "asc" ? "ascending" : "descending"})`}
      >
        <span>{label}</span>
        <svg
          className={`h-3 w-3 transition-transform ${active ? "opacity-100" : "opacity-0"} ${
            active && dir === "asc" ? "rotate-180 transform" : ""
          }`}
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
