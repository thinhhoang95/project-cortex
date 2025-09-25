"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ModalDialog from "./ModalDialog";
import ShimmeringText from "./ShimmeringText";
import FlightListStatistics from "./FlightListStatistics";
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
}: FlightQueryDialogProps) {
  const flights = useSimStore(state => state.flights);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<FlightQueryResponse | null>(null);
  const [resultFlightIds, setResultFlightIds] = useState<string[]>([]);
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

  const handleSelectFlights = useCallback(() => {
    if (!onSelectFlights) return;
    onSelectFlights(resultFlightIds);
  }, [onSelectFlights, resultFlightIds]);

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title={title}
      description="Query flights with natural language filters"
      width="w-[min(1280px,95vw)]"
      height="h-[min(900px,93vh)]"
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto no-scrollbar">
          <div className="p-6 space-y-6 text-white">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr),minmax(0,0.8fr)] lg:items-stretch">
          <div className="space-y-4 flex h-full flex-col">
            <div className="text-sm font-medium text-white/70">Prompt</div>
            <div className="relative">
              <div className="absolute -inset-4 rounded-[32px] bg-gradient-to-br from-blue-500/20 via-purple-500/15 to-pink-500/20 opacity-60 blur-3xl" aria-hidden />
              <div
                ref={promptCardRef}
                className="relative rounded-[28px] bg-gradient-to-br from-blue-500/60 via-purple-500/60 to-fuchsia-500/60 p-[1.5px] shadow-[0_25px_65px_-30px_rgba(76,29,149,0.9)]"
              >
                <div className="rounded-[28px] border border-white/15 bg-slate-950/70 px-6 py-6 backdrop-blur-[22px] shadow-inner">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.currentTarget.value)}
                    placeholder="Describe the flights you want to retrieve"
                    rows={6}
                    className="h-44 w-full resize-none rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4 text-base leading-relaxed text-white placeholder:text-white/50 focus:border-white/25 focus:outline-none focus:ring-2 focus:ring-purple-400/50"
                  />
                  <div className="mt-3 text-xs text-white/60">
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
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-transparent"></div>
                    <ShimmeringText text="Running query…" className="text-sm opacity-80" />
                  </div>
                ) : resultFlightRows.length > 0 ? (
                  <div className="flex-1 min-h-0 overflow-auto p-3">
                    <div className="rounded-lg border border-white/10 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-white/10 text-left">
                            <th className="text-center p-2 font-semibold w-8">✓</th>
                            <th className="p-2 font-semibold">CS</th>
                            <th className="p-2 font-semibold">Ori.</th>
                            <th className="p-2 font-semibold">Des.</th>
                            <th className="p-2 font-semibold">TV Arr.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resultFlightRows.map((row, idx) => (
                            <tr
                              key={`${row.flightId}-${idx}`}
                              className={`border-t border-white/10 ${idx % 2 === 0 ? "bg-white/0" : "bg-white/5"}`}
                            >
                              <td className="p-2 text-center w-8 text-xs">{row.isBaseline ? "✓" : ""}</td>
                              <td className="p-2 font-mono text-sm text-white">{row.callSign}</td>
                              <td className="p-2 text-white/80">{row.origin}</td>
                              <td className="p-2 text-white/80">{row.destination}</td>
                              <td className="p-2 text-right font-mono text-white/70">{row.arrivalTime}</td>
                            </tr>
                          ))}
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
              disabled={resultFlightIds.length === 0 || isSubmitting}
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
              <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white/60 border-t-transparent"></div>
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
    </div>
  </ModalDialog>
  );
}
