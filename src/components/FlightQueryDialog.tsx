"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import ModalDialog from "./ModalDialog";
import ShimmeringText from "./ShimmeringText";
import FlightListStatistics from "./FlightListStatistics";
import FlightPathsMiniMap from "./FlightPathsMiniMap";
import { useSimStore } from "./useSimStore";
import { authFetch } from "@/lib/auth";

interface FlightQueryDialogProps {
  open: boolean;
  onClose: () => void;
  initialPrompt?: string;
  flightIds?: string[];
  onSelectFlights?: (flightIds: string[]) => void;
  highlightLabel?: string;
  baselineLabel?: string;
  fullScreen?: boolean;
}

interface FlightQueryResponse {
  flight_ids?: string[];
  metadata?: Record<string, any> | null;
  [key: string]: any;
}

function normalizeFlightIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of raw) {
    if (value === null || value === undefined) continue;
    const id = String(value).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function formatTimeOfDay(seconds: number | null | undefined): string {
  if (!Number.isFinite(seconds ?? NaN)) return "—";
  const totalSeconds = Math.max(0, Math.round(seconds ?? 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export default function FlightQueryDialog({
  open,
  onClose,
  initialPrompt = "",
  flightIds,
  onSelectFlights,
  highlightLabel = "Query result",
  baselineLabel = "Baseline",
  fullScreen = false,
}: FlightQueryDialogProps) {
  const flights = useSimStore(state => state.flights);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<FlightQueryResponse | null>(null);
  const [resultFlightIds, setResultFlightIds] = useState<string[]>([]);
  const [selectedFlightIdSet, setSelectedFlightIdSet] = useState<Set<string>>(new Set());
  const promptCardRef = useRef<HTMLDivElement | null>(null);
  const [promptCardHeight, setPromptCardHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setPrompt(initialPrompt);
    setError(null);
  }, [open, initialPrompt]);

  useEffect(() => {
    if (!open) {
      setResultFlightIds([]);
      setResponse(null);
      setIsSubmitting(false);
      setError(null);
      setSelectedFlightIdSet(new Set());
    }
  }, [open]);

  const baselineFlightIds = useMemo(() => normalizeFlightIds(flightIds), [flightIds]);
  const baselineFlightIdSet = useMemo(() => new Set(baselineFlightIds.map(id => String(id))), [baselineFlightIds]);

  useEffect(() => {
    if (!open) return;
    if (baselineFlightIds.length === 0) return;
    setResultFlightIds(prev => {
      if (prev.length > 0) return prev;
      return baselineFlightIds;
    });
  }, [open, baselineFlightIds]);

  useEffect(() => {
    setSelectedFlightIdSet(new Set(resultFlightIds.map(id => String(id))));
  }, [resultFlightIds]);

  const title = useMemo(() => {
    const matchedCount = resultFlightIds.length;
    return matchedCount > 0
      ? `Flight Query · ${matchedCount.toLocaleString("en-US")}`
      : "Flight Query";
  }, [resultFlightIds.length]);

  const handleSubmit = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError("Prompt cannot be empty");
      return;
    }
    setIsSubmitting(true);
    setError(null);

    const body: Record<string, any> = { prompt: trimmedPrompt };
    const options: Record<string, any> = {};
    if (baselineFlightIds.length > 0) {
      options.flight_ids = baselineFlightIds;
    }
    if (Object.keys(options).length > 0) {
      body.options = options;
    }

    try {
      const resp = await authFetch("/api/flight_query_nlp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `Flight query failed (${resp.status})`);
      }

      const json = (await resp.json()) as FlightQueryResponse;
      const ids = normalizeFlightIds(json?.flight_ids ?? []);
      setResultFlightIds(ids);
      setResponse(json);
    } catch (err) {
      console.error("flight_query_nlp error", err);
      setError(err instanceof Error ? err.message : "Failed to execute flight query");
    } finally {
      setIsSubmitting(false);
    }
  };

  const metadata = response?.metadata ?? null;

  useEffect(() => {
    if (!open) {
      setPromptCardHeight(null);
      return;
    }
    const element = promptCardRef.current;
    if (!element) return;

    const updateHeight = () => {
      if (!promptCardRef.current) return;
      setPromptCardHeight(promptCardRef.current.offsetHeight);
    };

    updateHeight();

    let frame: number | null = null;
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          if (frame !== null) cancelAnimationFrame(frame);
          frame = requestAnimationFrame(updateHeight);
        })
      : null;

    if (observer) {
      observer.observe(element);
    }

    const handleResize = () => updateHeight();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", handleResize);
    }

    return () => {
      if (observer) observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", handleResize);
      }
    };
  }, [open, resultFlightIds.length, baselineFlightIds.length]);

  const flightListHeightStyle = useMemo(() => {
    if (!promptCardHeight || promptCardHeight <= 0) return undefined;
    const heightPx = `${promptCardHeight}px`;
    return { height: heightPx, maxHeight: heightPx };
  }, [promptCardHeight]);

  const flightsById = useMemo(() => {
    const map = new Map<string, (typeof flights)[number]>();
    for (const flight of flights) {
      if (!flight?.flightId) continue;
      map.set(String(flight.flightId), flight);
    }
    return map;
  }, [flights]);

  const resultFlightRows = useMemo(
    () =>
      resultFlightIds.map((rawId, index) => {
        const flightId = String(rawId);
        const flight = flightsById.get(flightId) ?? null;
        return {
          flightId,
          index,
          isBaseline: baselineFlightIdSet.has(flightId),
          callSign: flight?.callSign ? String(flight.callSign) : flightId,
          origin: flight?.origin ? String(flight.origin) : "—",
          destination: flight?.destination ? String(flight.destination) : "—",
          arrivalTime: flight ? formatTimeOfDay(flight.t1) : "—",
        };
      }),
    [baselineFlightIdSet, flightsById, resultFlightIds]
  );

  const mapFlightIds = useMemo(
    () => (resultFlightIds.length > 0 ? resultFlightIds : baselineFlightIds),
    [baselineFlightIds, resultFlightIds]
  );

  const selectedFlightIds = useMemo(
    () => resultFlightIds.filter(id => selectedFlightIdSet.has(String(id))),
    [resultFlightIds, selectedFlightIdSet]
  );

  const allowFlightSelection = baselineFlightIds.length > 0 && !!onSelectFlights;

  const toggleFlightSelection = useCallback(
    (flightId: string) => {
      if (!allowFlightSelection) return;
      setSelectedFlightIdSet(prev => {
        const next = new Set(prev);
        if (next.has(flightId)) {
          next.delete(flightId);
        } else {
          next.add(flightId);
        }
        return next;
      });
    },
    [allowFlightSelection]
  );

  const allResultFlightsSelected = useMemo(
    () => resultFlightIds.length > 0 && resultFlightIds.every((id) => selectedFlightIdSet.has(String(id))),
    [resultFlightIds, selectedFlightIdSet],
  );

  const toggleAllResultFlightSelection = useCallback(() => {
    if (!allowFlightSelection || resultFlightIds.length === 0) return;
    setSelectedFlightIdSet((prev) => {
      const allSelected = resultFlightIds.every((id) => prev.has(String(id)));
      if (allSelected) {
        const next = new Set(prev);
        for (const id of resultFlightIds) next.delete(String(id));
        return next;
      }
      const next = new Set(prev);
      for (const id of resultFlightIds) next.add(String(id));
      return next;
    });
  }, [allowFlightSelection, resultFlightIds]);

  const handleSelectFlights = useCallback(() => {
    if (!onSelectFlights) return;
    onSelectFlights(selectedFlightIds);
  }, [onSelectFlights, selectedFlightIds]);

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title={title}
      description="Query flights with natural language filters"
      width={fullScreen ? "w-[calc(100vw-3rem)]" : undefined}
      height={fullScreen ? "h-[calc(100vh-3rem)]" : undefined}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden text-white lg:flex-row">
        <div className="flex-1 min-w-0 overflow-y-auto no-scrollbar">
          <div className="p-6 space-y-6">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr),minmax(0,0.8fr)] lg:items-stretch">
              <div className="space-y-4 flex h-full flex-col">
                <div className="text-sm font-medium text-white/70">Prompt</div>
                <div className="relative">
                  <div className="absolute -inset-4 rounded-[32px] bg-gradient-to-br from-cyan-400/20 via-purple-500/20 to-pink-500/20 opacity-80 blur-3xl pointer-events-none" aria-hidden />
                  <div
                    ref={promptCardRef}
                    className="relative rounded-[28px] bg-gradient-to-br from-cyan-400 via-purple-500 to-pink-500 p-[2px] shadow-[0_0_80px_-20px_rgba(168,85,247,0.5)]"
                  >
                    <div className="rounded-[26px] bg-slate-950/80 px-5 py-5 backdrop-blur-3xl shadow-inner shadow-black/40">
                      <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.currentTarget.value)}
                        placeholder="Describe the flights you want to retrieve"
                        rows={6}
                        className="h-44 w-full resize-none bg-transparent px-2 py-2 text-base leading-relaxed text-white placeholder:text-white/40 focus:outline-none"
                      />
                      <div className="mt-3 text-xs text-white/50 px-2">
                        Include filters like traffic volumes, times, or sorting preferences.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4 flex h-full min-h-0 flex-col">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-white/70">Flight list</div>
                  <div className="text-xs text-white/50">
                    {resultFlightIds.length > 0
                      ? `${resultFlightIds.length.toLocaleString("en-US")} flights`
                      : "No results yet"}
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden" style={flightListHeightStyle}>
                  <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/5">
                    {isSubmitting ? (
                      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-white/70">
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-[color:var(--panel-border)] border-t-[color:var(--panel-text-primary)]"></div>
                        <ShimmeringText text="Running query…" className="text-sm opacity-80" />
                      </div>
                    ) : resultFlightRows.length > 0 ? (
                      <div className="flex-1 min-h-0 overflow-auto p-3">
                        <div className="rounded-lg border border-white/10 overflow-hidden">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-white/10 text-left">
                                <th className="text-center p-2 font-semibold w-8">
                                  {allowFlightSelection ? (
                                    <button
                                      type="button"
                                      className="w-full h-full text-center hover:text-white transition-colors"
                                      onClick={toggleAllResultFlightSelection}
                                      title={allResultFlightsSelected ? "Uncheck all flights" : "Check all flights"}
                                      aria-label={allResultFlightsSelected ? "Uncheck all flights" : "Check all flights"}
                                    >
                                      ✓
                                    </button>
                                  ) : (
                                    "✓"
                                  )}
                                </th>
                                <th className="p-2 font-semibold">CS</th>
                                <th className="p-2 font-semibold">Ori.</th>
                                <th className="p-2 font-semibold">Des.</th>
                                <th className="p-2 font-semibold">TV Arr.</th>
                              </tr>
                            </thead>
                            <tbody>
                              {resultFlightRows.map((row, idx) => {
                                const isAdmitted = selectedFlightIdSet.has(row.flightId);
                                const rowIsInteractive = allowFlightSelection;
                                const baseRowColor = idx % 2 === 0 ? "bg-white/0" : "bg-white/5";
                                const selectedRowColor = isAdmitted ? baseRowColor : "bg-rose-500/15";
                                const handleRowClick = rowIsInteractive
                                  ? () => toggleFlightSelection(row.flightId)
                                  : undefined;
                                const handleRowKeyDown = rowIsInteractive
                                  ? (event: ReactKeyboardEvent<HTMLTableRowElement>) => {
                                      if (event.key === " " || event.key === "Enter") {
                                        event.preventDefault();
                                        toggleFlightSelection(row.flightId);
                                      }
                                    }
                                  : undefined;
                                return (
                                  <tr
                                    key={`${row.flightId}-${idx}`}
                                    className={`border-t border-white/10 ${selectedRowColor} ${
                                      rowIsInteractive
                                        ? `cursor-pointer select-none transition ${
                                            isAdmitted
                                              ? "hover:bg-blue-500/20"
                                              : "hover:bg-rose-500/25"
                                          }`
                                        : ""
                                    }`}
                                    onClick={handleRowClick}
                                    onKeyDown={handleRowKeyDown}
                                    role={rowIsInteractive ? "button" : undefined}
                                    tabIndex={rowIsInteractive ? 0 : undefined}
                                  >
                                    <td className="p-2 text-center w-8 text-xs">
                                      {allowFlightSelection ? (
                                        <span className="inline-flex h-4 w-4 items-center justify-center">
                                          <input
                                            type="checkbox"
                                            checked={isAdmitted}
                                            onChange={() => toggleFlightSelection(row.flightId)}
                                            onClick={event => event.stopPropagation()}
                                            className="h-4 w-4 cursor-pointer rounded border border-white/40 bg-white/10 accent-blue-400"
                                            aria-label={
                                              isAdmitted
                                                ? `Admitted flight ${row.callSign}`
                                                : `Exclude flight ${row.callSign}`
                                            }
                                          />
                                        </span>
                                      ) : row.isBaseline ? (
                                        "✓"
                                      ) : (
                                        ""
                                      )}
                                    </td>
                                    <td className="p-2 font-mono text-sm text-white">
                                      <div className="flex items-center gap-2">
                                        <span className={isAdmitted ? undefined : "text-white/60 line-through"}>
                                          {row.callSign}
                                        </span>
                                        {row.isBaseline && (
                                          <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/70">
                                            Baseline
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className={`p-2 ${isAdmitted ? "text-white/80" : "text-white/50 line-through"}`}>
                                      {row.origin}
                                    </td>
                                    <td className={`p-2 ${isAdmitted ? "text-white/80" : "text-white/50 line-through"}`}>
                                      {row.destination}
                                    </td>
                                    <td className={`p-2 text-right font-mono ${
                                      isAdmitted ? "text-white/70" : "text-white/45 line-through"
                                    }`}
                                    >
                                      {row.arrivalTime}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-sm text-white/60">
                        <div>No flights yet.</div>
                        <div>Run a query to populate this list.</div>
                      </div>
                    )}
                    {baselineFlightIds.length > 0 && (
                      <div className="border-t border-white/10 px-4 py-2 text-xs text-white/55">
                        Constrained to {baselineFlightIds.length.toLocaleString("en-US")} baseline flights.
                      </div>
                    )}
                    {error && (
                      <div className="border-t border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
                        {error}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div
              className={`flex items-center gap-3 ${
                onSelectFlights ? "justify-between" : "justify-end"
              }`}
            >
              {onSelectFlights && (
                <button
                  type="button"
                  onClick={handleSelectFlights}
                  disabled={selectedFlightIds.length === 0 || isSubmitting}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-5 py-2 text-sm font-medium text-white/80 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Select these flights
                </button>
              )}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting || !prompt.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 px-5 py-2 text-sm font-medium shadow-[0_12px_35px_-18px_rgba(59,130,246,0.8)] transition hover:from-blue-600 hover:to-purple-700 disabled:cursor-not-allowed disabled:from-slate-600 disabled:to-slate-700 disabled:text-white/60"
              >
                {isSubmitting && (
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-[color:var(--panel-border)] border-t-[color:var(--panel-text-primary)]"></div>
                )}
                {isSubmitting ? <ShimmeringText text="Sending…" /> : "Send"}
              </button>
            </div>

            <FlightListStatistics
              flightIds={resultFlightIds}
              baselineFlightIds={baselineFlightIds}
              metadata={metadata}
              highlightLabel={highlightLabel}
              baselineLabel={baselineLabel}
            />
          </div>
        </div>
        <aside className="relative h-64 w-full flex-shrink-0 border-t border-white/10 bg-slate-950/40 lg:h-full lg:w-[380px] lg:border-t-0 lg:border-l xl:w-[420px]">
          <FlightPathsMiniMap
            flightIds={mapFlightIds}
            baselineFlightIds={resultFlightIds.length > 0 ? baselineFlightIds : undefined}
            className="relative h-full w-full"
          />
        </aside>
      </div>
    </ModalDialog>
  );
}
