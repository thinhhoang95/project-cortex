"use client";

import { useEffect, useMemo, useState } from "react";
import { Trash2, X } from "lucide-react";
import GlobalTVBasket from "@/components/GlobalTVBasket";
import ModalDialog from "@/components/ModalDialog";
import { useGlobalTVBasketStore } from "@/components/useGlobalTVBasketStore";
import { useHotspotSettingsStore } from "@/components/useHotspotSettingsStore";
import { useSimStore } from "@/components/useSimStore";
import { useThemeStore } from "@/components/useThemeStore";
import {
  DEFAULT_HOTSPOT_COLORING_SETTINGS,
  HOTSPOT_COLORS,
  isValidThresholdOrder,
  type HotspotThresholdSet,
  type HotspotThresholdUnit,
  type TrafficVolumeHotspotThreshold,
} from "@/lib/hotspotColoring";
import type { ThemePreference } from "@/styles/theme";

type TrafficVolumeFeature = {
  properties?: {
    traffic_volume_id?: string;
    airspace_id?: string;
  };
};

type SettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  trafficVolumes: TrafficVolumeFeature[];
};

type SettingsSection = "general" | "tv_scope";

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  description: string;
}> = [
  { value: "light", label: "Light", description: "Brighter glass surfaces" },
  { value: "dark", label: "Dark", description: "Reduced-glare workspace" },
  { value: "system", label: "System", description: "Follow this device" },
];

const inputClass =
  "glass-input w-full rounded-xl px-3 py-2 text-sm outline-none transition focus:border-blue-400/70 focus:ring-2 focus:ring-blue-400/20";

function ThresholdFields({
  value,
  onChange,
}: {
  value: HotspotThresholdSet;
  onChange: (value: HotspotThresholdSet) => void;
}) {
  const suffix = value.unit === "percentage" ? "%" : "flights";
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {(["orange", "red", "violet"] as const).map((severity) => (
        <label
          key={severity}
          className="rounded-xl border border-white/10 bg-white/[0.045] p-3 transition focus-within:border-white/25"
        >
          <span className="mb-2 flex items-center gap-2 text-xs font-medium capitalize">
            <span
              className="h-2.5 w-2.5 rounded-full shadow-[0_0_12px_currentColor]"
              style={{ backgroundColor: HOTSPOT_COLORS[severity], color: HOTSPOT_COLORS[severity] }}
            />
            {severity}
          </span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              step={value.unit === "percentage" ? 1 : 1}
              value={value[severity]}
              onChange={(event) => onChange({
                ...value,
                [severity]: Number(event.target.value),
              })}
              className={`${inputClass} min-w-0 font-mono`}
              aria-label={`${severity} threshold`}
            />
            <span className="shrink-0 text-[11px] text-[var(--panel-text-muted)]">{suffix}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function UnitSelect({
  value,
  onChange,
  ariaLabel,
}: {
  value: HotspotThresholdUnit;
  onChange: (value: HotspotThresholdUnit) => void;
  ariaLabel: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as HotspotThresholdUnit)}
      className={`${inputClass} w-auto min-w-44`}
      aria-label={ariaLabel}
    >
      <option value="percentage">Percentage of capacity</option>
      <option value="absolute">Absolute traffic volume</option>
    </select>
  );
}

export default function SettingsDialog({
  open,
  onClose,
  trafficVolumes,
}: SettingsDialogProps) {
  const preference = useThemeStore((state) => state.preference);
  const setTheme = useThemeStore((state) => state.setTheme);
  const settings = useHotspotSettingsStore((state) => state.settings);
  const setSettings = useHotspotSettingsStore((state) => state.setSettings);
  const reapplyHotspotSettings = useSimStore((state) => state.reapplyHotspotSettings);
  const pinnedTvIds = useGlobalTVBasketStore((state) => state.pinnedTvIds);
  const basketSearchQuery = useGlobalTVBasketStore((state) => state.searchQuery);
  const clearBasketPins = useGlobalTVBasketStore((state) => state.clearPins);
  const setBasketSearchQuery = useGlobalTVBasketStore((state) => state.setSearchQuery);
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [confirmClearScope, setConfirmClearScope] = useState(false);
  const [globalDraft, setGlobalDraft] = useState(settings.global);
  const [globalError, setGlobalError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tvQuery, setTvQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [overrideDraft, setOverrideDraft] = useState<HotspotThresholdSet>(settings.global);
  const [overrideError, setOverrideError] = useState("");

  useEffect(() => {
    if (!open) return;
    setGlobalDraft(settings.global);
    setGlobalError("");
    setEditingId(null);
    setTvQuery("");
    setOverrideDraft(settings.global);
    setOverrideError("");
    setActiveSection("general");
    setConfirmClearScope(false);
  }, [open]);

  const trafficVolumeOptions = useMemo(() => Array.from(
    new Map(
      trafficVolumes
        .map((feature) => {
          const id = String(feature.properties?.traffic_volume_id ?? "").trim();
          return id ? [id.toLowerCase(), {
            id,
            airspaceId: String(feature.properties?.airspace_id ?? "").trim(),
          }] as const : null;
        })
        .filter((item): item is readonly [string, { id: string; airspaceId: string }] => item !== null),
    ).values(),
  ).sort((a, b) => a.id.localeCompare(b.id)), [trafficVolumes]);
  const trafficVolumeIds = useMemo(
    () => trafficVolumeOptions.map((option) => option.id),
    [trafficVolumeOptions],
  );

  const suggestions = useMemo(() => {
    const query = tvQuery.trim().toLowerCase();
    if (!query || editingId) return [];
    return trafficVolumeOptions
      .filter((option) => option.id.toLowerCase().includes(query))
      .slice(0, 8);
  }, [editingId, trafficVolumeOptions, tvQuery]);

  const persist = (next: typeof settings) => {
    setSettings(next);
    queueMicrotask(reapplyHotspotSettings);
  };

  const saveGlobal = () => {
    if (!isValidThresholdOrder(globalDraft)) {
      setGlobalError("Use increasing values: violet must be greater than red, and red greater than orange.");
      return;
    }
    persist({ ...settings, global: globalDraft });
    setGlobalError("");
  };

  const startEditing = (override: TrafficVolumeHotspotThreshold) => {
    setEditingId(override.trafficVolumeId);
    setTvQuery(override.trafficVolumeId);
    setOverrideDraft({
      unit: override.unit,
      orange: override.orange,
      red: override.red,
      violet: override.violet,
    });
    setOverrideError("");
  };

  const resetEditor = () => {
    setEditingId(null);
    setTvQuery("");
    setOverrideDraft(settings.global);
    setOverrideError("");
    setShowSuggestions(false);
  };

  const saveOverride = () => {
    const trafficVolumeId = tvQuery.trim();
    if (!trafficVolumeId) {
      setOverrideError("Select a traffic volume.");
      return;
    }
    const knownTrafficVolume = trafficVolumeOptions.some(
      (option) => option.id.toLowerCase() === trafficVolumeId.toLowerCase(),
    );
    if (!knownTrafficVolume) {
      setOverrideError("Choose a traffic volume from the suggestions.");
      return;
    }
    if (!isValidThresholdOrder(overrideDraft)) {
      setOverrideError("Violet must be greater than red, and red greater than orange.");
      return;
    }

    const nextOverride: TrafficVolumeHotspotThreshold = {
      trafficVolumeId,
      ...overrideDraft,
    };
    persist({
      ...settings,
      overrides: [
        ...settings.overrides.filter(
          (item) => item.trafficVolumeId.toLowerCase() !==
            (editingId ?? trafficVolumeId).toLowerCase(),
        ),
        nextOverride,
      ],
    });
    resetEditor();
  };

  const deleteOverride = (trafficVolumeId: string) => {
    persist({
      ...settings,
      overrides: settings.overrides.filter(
        (item) => item.trafficVolumeId.toLowerCase() !== trafficVolumeId.toLowerCase(),
      ),
    });
    if (editingId?.toLowerCase() === trafficVolumeId.toLowerCase()) resetEditor();
  };

  const resetDefaults = () => {
    persist({
      global: { ...DEFAULT_HOTSPOT_COLORING_SETTINGS.global },
      overrides: [],
    });
    setGlobalDraft({ ...DEFAULT_HOTSPOT_COLORING_SETTINGS.global });
    resetEditor();
  };

  const clearTvScope = () => {
    clearBasketPins();
    setBasketSearchQuery("");
    setConfirmClearScope(false);
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Settings"
      description="Personalize Cortex for this browser."
      width="w-[min(980px,95vw)]"
      height="h-[min(760px,92vh)]"
      headerActions={activeSection === "general" ? (
        <button
          type="button"
          onClick={resetDefaults}
          className="mr-1 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-[var(--panel-text-muted)] transition hover:bg-white/10 hover:text-[var(--panel-text-primary)]"
        >
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.5 15.5A8 8 0 1 0 6 7.5L4 10" />
          </svg>
          Restore defaults
        </button>
      ) : null}
    >
      <div className="flex min-h-full">
        <aside className="w-52 shrink-0 border-r border-white/10 bg-black/10 p-4">
          <button
            type="button"
            onClick={() => {
              setActiveSection("general");
              setConfirmClearScope(false);
            }}
            aria-current={activeSection === "general" ? "page" : undefined}
            className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition ${
              activeSection === "general"
                ? "border-blue-400/20 bg-blue-500/15 text-blue-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                : "border-transparent text-[var(--panel-text-muted)] hover:border-white/10 hover:bg-white/5 hover:text-[var(--panel-text-primary)]"
            }`}
          >
            <svg className="h-4 w-4 text-blue-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.55 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.4v-4h.09A1.7 1.7 0 0 0 4.2 8.55a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.55 4.2a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.4h4v.09A1.7 1.7 0 0 0 15 4.2a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.55a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.09v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
            </svg>
            General
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("tv_scope")}
            aria-current={activeSection === "tv_scope" ? "page" : undefined}
            className={`mt-2 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition ${
              activeSection === "tv_scope"
                ? "border-blue-400/20 bg-blue-500/15 text-blue-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                : "border-transparent text-[var(--panel-text-muted)] hover:border-white/10 hover:bg-white/5 hover:text-[var(--panel-text-primary)]"
            }`}
          >
            <svg className="h-4 w-4 text-blue-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M6 12h12M6 17h7" />
              <path strokeLinecap="round" strokeLinejoin="round" d="m17 15 1.5 1.5L22 13" />
            </svg>
            TV Scope
          </button>
        </aside>

        <main className="modal-scrollbar min-w-0 flex-1 overflow-y-auto px-7 py-6">
          {activeSection === "general" ? (
            <>
          <section>
            <div className="mb-4">
              <h2 className="text-base font-semibold">Theme</h2>
              <p className="mt-1 text-xs text-[var(--panel-text-muted)]">
                Choose how glass surfaces and map details appear.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {THEME_OPTIONS.map((option) => {
                const selected = preference === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setTheme(option.value)}
                    aria-pressed={selected}
                    className={`rounded-2xl border p-3 text-left transition ${
                      selected
                        ? "border-blue-400/60 bg-blue-500/15 ring-2 ring-blue-400/10"
                        : "border-white/10 bg-white/[0.045] hover:border-white/25 hover:bg-white/[0.07]"
                    }`}
                  >
                    <div className="mb-3 flex h-14 gap-1.5 overflow-hidden rounded-lg border border-white/10 bg-slate-950/70 p-2">
                      <span className={`w-4 rounded ${option.value === "light" ? "bg-slate-200" : option.value === "dark" ? "bg-slate-800" : "bg-gradient-to-b from-slate-200 to-slate-800"}`} />
                      <span className={`flex-1 rounded ${option.value === "light" ? "bg-slate-400/70" : option.value === "dark" ? "bg-slate-700" : "bg-gradient-to-b from-slate-400 to-slate-700"}`} />
                    </div>
                    <span className="flex items-center justify-between text-sm font-medium">
                      {option.label}
                      <span className={`h-2.5 w-2.5 rounded-full border ${selected ? "border-blue-300 bg-blue-400" : "border-white/30"}`} />
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[var(--panel-text-muted)]">{option.description}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="my-7 border-t border-white/10" />

          <section>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Hotspot Coloring</h2>
                <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--panel-text-muted)]">
                  Cortex filters the API result once more using these thresholds. Values below orange are not shown as hotspots.
                </p>
              </div>
              <UnitSelect
                value={globalDraft.unit}
                ariaLabel="Global threshold measurement"
                onChange={(unit) => setGlobalDraft({
                  ...(unit === "percentage"
                    ? DEFAULT_HOTSPOT_COLORING_SETTINGS.global
                    : { unit: "absolute" as const, orange: 40, red: 55, violet: 70 }),
                  unit,
                })}
              />
            </div>
            <ThresholdFields value={globalDraft} onChange={setGlobalDraft} />
            <div className="mt-3 flex items-center justify-between gap-4">
              <p className="text-[11px] text-[var(--panel-text-muted)]">
                Global fallback · violet &gt; red &gt; orange
              </p>
              <button
                type="button"
                onClick={saveGlobal}
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/60 bg-emerald-500/20 px-2.5 py-1.5 text-[12px] font-medium text-emerald-100 transition-colors hover:bg-emerald-500/25"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" />
                </svg>
                Apply global thresholds
              </button>
            </div>
            {globalError && <p className="mt-2 text-xs text-red-300">{globalError}</p>}

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Traffic volume overrides</h3>
                  <p className="mt-0.5 text-[11px] text-[var(--panel-text-muted)]">
                    Specific values take precedence over the global threshold.
                  </p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-[var(--panel-text-muted)]">
                  {settings.overrides.length} configured
                </span>
              </div>

              {settings.overrides.length > 0 && (
                <div className="mb-4 space-y-2">
                  {settings.overrides
                    .slice()
                    .sort((a, b) => a.trafficVolumeId.localeCompare(b.trafficVolumeId))
                    .map((override) => (
                      <div
                        key={override.trafficVolumeId}
                        className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/10 px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-xs font-semibold">{override.trafficVolumeId}</p>
                          <p className="mt-0.5 text-[10px] text-[var(--panel-text-muted)]">
                            {override.orange} / {override.red} / {override.violet}
                            {override.unit === "percentage" ? "% of capacity" : " flights"}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => startEditing(override)}
                            className="rounded-lg p-2 text-[var(--panel-text-muted)] transition hover:bg-white/10 hover:text-white"
                            aria-label={`Edit ${override.trafficVolumeId}`}
                            title="Edit"
                          >
                            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="m4 20 4.2-1 10.6-10.6a2 2 0 0 0-2.8-2.8L5.4 16.2 4 20Z" />
                              <path d="m14.5 7.1 2.8 2.8" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteOverride(override.trafficVolumeId)}
                            className="rounded-lg p-2 text-[var(--panel-text-muted)] transition hover:bg-red-500/15 hover:text-red-300"
                            aria-label={`Delete ${override.trafficVolumeId}`}
                            title="Delete"
                          >
                            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}

              <div className="rounded-xl border border-dashed border-white/15 bg-black/10 p-3.5">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="relative">
                    <label className="mb-1.5 block text-[11px] font-medium text-[var(--panel-text-muted)]">
                      Traffic volume
                    </label>
                    <input
                      value={tvQuery}
                      disabled={Boolean(editingId)}
                      onChange={(event) => {
                        setTvQuery(event.target.value);
                        setShowSuggestions(true);
                      }}
                      onFocus={() => setShowSuggestions(true)}
                      onBlur={() => window.setTimeout(() => setShowSuggestions(false), 150)}
                      placeholder="Search by traffic volume ID…"
                      className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-65`}
                    />
                    {showSuggestions && suggestions.length > 0 && (
                      <div className="glass-menu absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-xl py-1 shadow-2xl">
                        {suggestions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setTvQuery(option.id);
                              setShowSuggestions(false);
                            }}
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-xs transition hover:bg-[var(--menu-hover-bg)]"
                          >
                            <span className="font-mono font-medium">{option.id}</span>
                            {option.airspaceId && <span className="glass-menu-muted ml-3 truncate text-[10px]">{option.airspaceId}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] font-medium text-[var(--panel-text-muted)]">
                      Measurement
                    </label>
                    <UnitSelect
                      value={overrideDraft.unit}
                      ariaLabel="Override threshold measurement"
                      onChange={(unit) => setOverrideDraft({
                        ...(unit === "percentage"
                          ? DEFAULT_HOTSPOT_COLORING_SETTINGS.global
                          : { unit: "absolute" as const, orange: 40, red: 55, violet: 70 }),
                        unit,
                      })}
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <ThresholdFields value={overrideDraft} onChange={setOverrideDraft} />
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  {editingId && (
                    <button
                      type="button"
                      onClick={resetEditor}
                      className="rounded-lg px-3 py-2 text-xs text-[var(--panel-text-muted)] transition hover:bg-white/10 hover:text-white"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={saveOverride}
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/60 bg-emerald-500/20 px-2.5 py-1.5 text-[12px] font-medium text-emerald-100 transition-colors hover:bg-emerald-500/25"
                  >
                    {!editingId && (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path strokeLinecap="round" d="M12 5v14M5 12h14" />
                      </svg>
                    )}
                    {editingId ? "Save override" : "Add override"}
                  </button>
                </div>
                {overrideError && <p className="mt-2 text-xs text-red-300">{overrideError}</p>}
              </div>
            </div>
          </section>
            </>
          ) : (
            <section>
              <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold">Traffic Volume Scope</h2>
                  <p className="mt-1 max-w-xl text-xs leading-5 text-[var(--panel-text-muted)]">
                    Manage the global traffic volumes you are concerned about. Changes apply immediately to every supported histogram view in Cortex.
                  </p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-[var(--panel-text-muted)]">
                  {pinnedTvIds.length} pinned
                </span>
              </div>

              <GlobalTVBasket
                contextTvIds={trafficVolumeIds}
              />

              <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold">Clear TV scope</h3>
                    <p className="mt-1 max-w-lg text-[11px] leading-5 text-[var(--panel-text-muted)]">
                      Remove all pinned traffic volumes and clear the active search filter. Dormant pins from other resource dates are removed too.
                    </p>
                  </div>
                  {confirmClearScope ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmClearScope(false)}
                        className="rounded-lg px-3 py-2 text-xs text-[var(--panel-text-muted)] transition hover:bg-white/10 hover:text-white"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={clearTvScope}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/50 bg-red-500/20 px-3 py-2 text-xs font-medium text-red-100 transition hover:bg-red-500/30"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        Confirm clear all
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmClearScope(true)}
                      disabled={pinnedTvIds.length === 0 && basketSearchQuery.length === 0}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-100 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Clear all TV scope
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </ModalDialog>
  );
}
