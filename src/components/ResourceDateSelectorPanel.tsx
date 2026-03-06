"use client";

import { useEffect, useMemo, useState } from "react";

import PanelCloseButton from "@/components/PanelCloseButton";
import ShimmeringText from "@/components/ShimmeringText";
import { clearAppCache } from "@/lib/cache";
import { fetchResourceContext, selectResourceDate } from "@/lib/resourceContextClient";
import { clearTrafficVolumeCache } from "@/lib/trafficVolumes";
import { clearTvCapacityRangesCache } from "@/lib/tvCapacityRanges";
import {
  formatResourceDateForDisplay,
  getResourceStatusLabel,
  mergeResourceAvailability,
  type ResourceContextResponse,
  type ResourceDateAvailability,
} from "@/lib/resourceDates";
import { useSimStore } from "@/components/useSimStore";

type ResourceDateSelectorPanelProps = {
  variant?: "dialog" | "page";
  open?: boolean;
  onClose?: () => void;
  onComplete?: (date: string) => void;
  reason?: string | null;
};

type MonthOption = {
  key: string;
  label: string;
  year: number;
  monthIndex: number;
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export default function ResourceDateSelectorPanel({
  variant = "dialog",
  open = true,
  onClose,
  onComplete,
  reason,
}: ResourceDateSelectorPanelProps) {
  const resourceDate = useSimStore((state) => state.resourceDate);
  const setResourceDate = useSimStore((state) => state.setResourceDate);
  const [resourceContext, setResourceContext] = useState<ResourceContextResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(resourceDate);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    setLoading(true);
    setError(null);

    fetchResourceContext()
      .then((context) => {
        if (cancelled) return;
        setResourceContext(context);
      })
      .catch((fetchError) => {
        if (cancelled) return;
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load resource dates");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const availability = useMemo(
    () => mergeResourceAvailability(resourceContext, resourceDate),
    [resourceContext, resourceDate],
  );

  useEffect(() => {
    if (!availability.length) return;
    if (selectedDate && availability.some((entry) => entry.date === selectedDate)) return;
    setSelectedDate(
      resourceDate ??
        resourceContext?.selected_date ??
        availability.find((entry) => entry.status === "ready")?.date ??
        availability[0]?.date ??
        null,
    );
  }, [availability, resourceContext?.selected_date, resourceDate, selectedDate]);

  const monthOptions = useMemo(() => buildMonthOptions(availability), [availability]);
  const [activeMonthKey, setActiveMonthKey] = useState<string | null>(null);

  useEffect(() => {
    if (!monthOptions.length) {
      setActiveMonthKey(null);
      return;
    }
    if (activeMonthKey && monthOptions.some((month) => month.key === activeMonthKey)) return;
    const selectedMonthKey = selectedDate ? getMonthKey(selectedDate) : null;
    setActiveMonthKey(selectedMonthKey && monthOptions.some((month) => month.key === selectedMonthKey) ? selectedMonthKey : monthOptions[0].key);
  }, [activeMonthKey, monthOptions, selectedDate]);

  const activeMonth = monthOptions.find((option) => option.key === activeMonthKey) ?? monthOptions[0] ?? null;
  const activeCalendar = useMemo(
    () => (activeMonth ? buildCalendarWeeks(activeMonth.year, activeMonth.monthIndex, availability) : []),
    [activeMonth, availability],
  );
  const selectedAvailability = availability.find((entry) => entry.date === selectedDate) ?? null;
  const canConfirm = !!selectedAvailability && selectedAvailability.status === "ready" && pendingDate === null;

  if (!open) return null;

  const panel = (
    <div className="rounded-[28px] border border-white/20 bg-white/12 text-white shadow-[0_30px_80px_-35px_rgba(14,165,233,0.55)] backdrop-blur-xl">
      <div className="border-b border-white/10 px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-white">
              {variant === "page" ? "Pick the data snapshot to load" : "Switch data snapshot"}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">
              Only dates supported by both the backend runtime and the local manifest can be activated.
            </p>
          </div>
          {variant === "dialog" && onClose ? (
            <PanelCloseButton onClick={onClose} ariaLabel="Close date selector" title="Close date selector" />
          ) : null}
        </div>
        {reason ? (
          <div className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100/90">
            {reason}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1.35fr)_320px]">
        <section className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {monthOptions.map((month) => (
                <button
                  key={month.key}
                  type="button"
                  onClick={() => setActiveMonthKey(month.key)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    month.key === activeMonthKey
                      ? "bg-cyan-300 text-slate-950"
                      : "bg-white/8 text-white/75 hover:bg-white/14 hover:text-white"
                  }`}
                >
                  {month.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-white/55">
              <LegendDot className="bg-emerald-300" /> Ready
              <LegendDot className="bg-amber-300" /> Missing local
              <LegendDot className="bg-rose-300" /> Missing API
            </div>
          </div>

          <div className="grid grid-cols-7 gap-2">
            {WEEKDAY_LABELS.map((weekday) => (
              <div key={weekday} className="px-2 py-1 text-center text-[11px] uppercase tracking-[0.2em] text-white/40">
                {weekday}
              </div>
            ))}
            {activeCalendar.map((week, weekIndex) =>
              week.map((cell, cellIndex) => {
                if (!cell) {
                  return <div key={`empty-${weekIndex}-${cellIndex}`} className="aspect-square rounded-2xl border border-transparent" />;
                }
                const selected = selectedDate === cell.date;
                const statusClass =
                  cell.status === "ready"
                    ? "border-emerald-300/30 bg-emerald-300/10 text-white hover:border-emerald-200/60"
                    : cell.status === "missing_local"
                      ? "border-amber-300/30 bg-amber-300/10 text-white/85 hover:border-amber-200/60"
                      : "border-rose-300/30 bg-rose-300/10 text-white/85 hover:border-rose-200/60";

                return (
                  <button
                    key={cell.date}
                    type="button"
                    onClick={() => setSelectedDate(cell.date)}
                    className={`aspect-square rounded-2xl border p-2 text-left transition ${statusClass} ${
                      selected ? "ring-2 ring-cyan-300/80" : "ring-0"
                    }`}
                    aria-pressed={selected}
                  >
                    <div className="flex h-full flex-col justify-between">
                      <div className="text-sm font-semibold">{cell.dayNumber}</div>
                      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em]">
                        <span className="opacity-70">{cell.status === "ready" ? "ok" : cell.status === "missing_local" ? "local" : "api"}</span>
                        {cell.isActive ? <span className="text-cyan-100">active</span> : null}
                      </div>
                    </div>
                  </button>
                );
              }),
            )}
          </div>
        </section>

        <aside className="rounded-[24px] border border-white/10 bg-slate-950/40 p-5">
          <div className="text-xl font-semibold text-white">
            {selectedAvailability ? formatResourceDateForDisplay(selectedAvailability.date) : "No date selected"}
          </div>

          {selectedAvailability ? (
            <>
              <div className="mt-4 inline-flex rounded-full border border-white/10 bg-white/8 px-3 py-1 text-xs font-medium text-white/80">
                {getResourceStatusLabel(selectedAvailability.status)}
              </div>

              <div className="mt-5 space-y-3 text-sm">
                <SupportRow label="Local manifest" supported={selectedAvailability.localSupported} />
                <SupportRow label="Backend runtime" supported={selectedAvailability.apiSupported} />
                {selectedAvailability.missingLocalKeys.length > 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-white/70">
                    Missing local entries: {selectedAvailability.missingLocalKeys.join(", ")}
                  </div>
                ) : null}
                {!selectedAvailability.apiSupported ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-white/70">
                    The backend does not advertise this date in `resource_context`.
                  </div>
                ) : null}
                {resourceContext ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-white/55">
                    Runtime generation: {resourceContext.generation}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="mt-4 text-sm text-white/55">Choose a date to inspect client and API support.</div>
          )}

          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              disabled={!canConfirm}
              onClick={async () => {
                if (!selectedAvailability || selectedAvailability.status !== "ready") return;
                setPendingDate(selectedAvailability.date);
                setError(null);
                try {
                  const nextContext = await selectResourceDate(selectedAvailability.date);
                  await clearAppCache();
                  clearTrafficVolumeCache();
                  clearTvCapacityRangesCache();
                  const activeDate = nextContext.selected_date ?? selectedAvailability.date;
                  setResourceDate(activeDate);
                  setResourceContext(nextContext);
                  onComplete?.(activeDate);
                } catch (switchError) {
                  setError(switchError instanceof Error ? switchError.message : "Failed to switch resource date");
                } finally {
                  setPendingDate(null);
                }
              }}
              className="rounded-full bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
            >
              {pendingDate ? (
                <ShimmeringText
                  text={`Switching to ${pendingDate}...`}
                  className="text-sm font-semibold"
                  theme="dark"
                />
              ) : variant === "page" ? (
                "Continue"
              ) : (
                "Apply Date"
              )}
            </button>
            {variant === "dialog" && onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white/75 transition hover:bg-white/10 hover:text-white"
              >
                Cancel
              </button>
            ) : null}
          </div>

          {loading ? (
            <div className="mt-4 text-sm text-white/55">
              <ShimmeringText text="Loading available dates..." className="text-sm font-medium" />
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );

  if (variant === "page") {
    return panel;
  }

  return (
    <div className="fixed inset-0 z-[2600] flex items-center justify-center bg-slate-950/68 px-4 py-8 backdrop-blur-md">
      <div className="w-full max-w-6xl">{panel}</div>
    </div>
  );
}

function SupportRow({ label, supported }: { label: string; supported: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5">
      <span className="text-white/70">{label}</span>
      <span className={supported ? "text-emerald-200" : "text-rose-200"}>{supported ? "Available" : "Missing"}</span>
    </div>
  );
}

function LegendDot({ className }: { className: string }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${className}`} aria-hidden="true" />;
}

function buildMonthOptions(availability: ResourceDateAvailability[]): MonthOption[] {
  const map = new Map<string, MonthOption>();
  for (const entry of availability) {
    const date = new Date(`${entry.date}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) continue;
    const year = date.getUTCFullYear();
    const monthIndex = date.getUTCMonth();
    const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    if (map.has(key)) continue;
    map.set(key, {
      key,
      label: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(date),
      year,
      monthIndex,
    });
  }
  return Array.from(map.values()).sort((left, right) => left.key.localeCompare(right.key));
}

function buildCalendarWeeks(year: number, monthIndex: number, availability: ResourceDateAvailability[]) {
  const availabilityByDate = new Map(availability.map((entry) => [entry.date, entry]));
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const firstWeekdayIndex = (firstDay.getUTCDay() + 6) % 7;
  const cells: Array<ResourceDateAvailability | null> = Array.from({ length: firstWeekdayIndex }, () => null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push(availabilityByDate.get(date) ?? {
      date,
      status: "missing_both",
      localSupported: false,
      apiSupported: false,
      missingLocalKeys: [],
      isActive: false,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const weeks: Array<Array<(ResourceDateAvailability & { dayNumber: string }) | null>> = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(
      cells.slice(index, index + 7).map((entry) =>
        entry
          ? {
              ...entry,
              dayNumber: entry.date.slice(-2),
            }
          : null,
      ),
    );
  }
  return weeks;
}

function getMonthKey(date: string): string {
  return date.slice(0, 7);
}
