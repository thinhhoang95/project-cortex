"use client";

import { useEffect, useMemo, useState } from "react";
import ModalDialog from "./ModalDialog";
import FlightListStatistics, { buildAnalysisForFlightIds } from "./FlightListStatistics";
import { useSimStore } from "./useSimStore";
import { authFetch } from "@/lib/auth";

interface FlightQueryDialogProps {
  open: boolean;
  onClose: () => void;
  initialPrompt?: string;
  flightIds?: string[];
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

export default function FlightQueryDialog({
  open,
  onClose,
  initialPrompt = "",
  flightIds,
  highlightLabel = "Query result",
  baselineLabel = "Baseline",
}: FlightQueryDialogProps) {
  const flights = useSimStore(state => state.flights);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<FlightQueryResponse | null>(null);
  const [resultFlightIds, setResultFlightIds] = useState<string[]>([]);

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

  const analysisSnapshot = useMemo(
    () => buildAnalysisForFlightIds(flights, resultFlightIds),
    [flights, resultFlightIds]
  );

  const title = useMemo(() => {
    const matchedCount = analysisSnapshot.selectedFlights.length;
    return matchedCount > 0
      ? `Flight Query · ${matchedCount.toLocaleString("en-US")}`
      : "Flight Query";
  }, [analysisSnapshot.selectedFlights.length]);

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
  const resultMetadataItems = useMemo(() => {
    if (!metadata) return [] as { label: string; value: string }[];
    const items: { label: string; value: string }[] = [];
    if (Number.isFinite(metadata.total_matches)) {
      items.push({ label: "Total matches", value: Number(metadata.total_matches).toLocaleString("en-US") });
    }
    if (Number.isFinite(metadata.result_size)) {
      items.push({ label: "Result size", value: Number(metadata.result_size).toLocaleString("en-US") });
    }
    if (metadata.time_range) {
      items.push({ label: "Time", value: String(metadata.time_range) });
    }
    return items;
  }, [metadata]);

  const submittingLabel = isSubmitting ? "Sending…" : "Send";
  const disableSend = isSubmitting || !prompt.trim();

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title={title}
      description="Query flights with natural language filters"
      width="w-[min(1280px,95vw)]"
      height="h-[min(900px,93vh)]"
    >
      <div className="p-6 space-y-6 text-white">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr),minmax(0,0.8fr)]">
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium text-white/70">Prompt</div>
              <div className="relative">
                <div className="absolute -inset-4 rounded-[32px] bg-gradient-to-br from-blue-500/20 via-purple-500/15 to-pink-500/20 opacity-60 blur-3xl" aria-hidden />
                <div className="relative rounded-[28px] bg-gradient-to-br from-blue-500/60 via-purple-500/60 to-fuchsia-500/60 p-[1.5px] shadow-[0_25px_65px_-30px_rgba(76,29,149,0.9)]">
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
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-white/70">Flight list</div>
              <div className="text-xs text-white/50">
                {resultFlightIds.length > 0
                  ? `${resultFlightIds.length.toLocaleString("en-US")} flights`
                  : "No results yet"}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 h-[260px] overflow-y-auto">
              {isSubmitting ? (
                <div className="flex h-full items-center justify-center gap-3 text-sm text-white/70">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-transparent" />
                  <span>Running query…</span>
                </div>
              ) : resultFlightIds.length > 0 ? (
                <div className="space-y-2 text-sm">
                  <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-white/70">
                    {resultFlightIds.map((id, index) => (
                      <div key={`${id}-${index}`} className="contents">
                        <div className="text-right text-white/40 font-mono text-[11px]">{index + 1}.</div>
                        <div className="font-mono text-white/85 break-all">{id}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-sm text-white/60">
                  <div>No flights yet.</div>
                  <div>Run a query to populate this list.</div>
                </div>
              )}
            </div>
            {baselineFlightIds.length > 0 && (
              <div className="text-xs text-white/50">
                Constrained to {baselineFlightIds.length.toLocaleString("en-US")} baseline flights.
              </div>
            )}
            {resultMetadataItems.length > 0 && (
              <div className="grid gap-2 text-xs text-white/60">
                {resultMetadataItems.map(item => (
                  <div key={item.label} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                    <span>{item.label}</span>
                    <span className="font-mono text-white/80">{item.value}</span>
                  </div>
                ))}
              </div>
            )}
            {error && (
              <div className="text-xs text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">{error}</div>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={disableSend}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 px-5 py-2 text-sm font-medium shadow-[0_12px_35px_-18px_rgba(59,130,246,0.8)] transition hover:from-blue-600 hover:to-purple-700 disabled:cursor-not-allowed disabled:from-slate-600 disabled:to-slate-700 disabled:text-white/60"
          >
            {isSubmitting && (
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
              </span>
            )}
            {submittingLabel}
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
    </ModalDialog>
  );
}
