"use client";

import type { ChangeEvent } from "react";

import ShimmeringText from "@/components/ShimmeringText";
import {
  RAD_PREVIEW_SEARCH_FIELDS,
  type RadLegitimacyFlag,
  type RadPreviewRow,
  type RadPreviewSearchField,
  type RadPreviewSortMode,
} from "@/lib/radPreview";

type RadPreviewRuleBrowserPanelProps = {
  rows: RadPreviewRow[];
  selectedRadId: string | null;
  legitimacyFlag: RadLegitimacyFlag;
  title?: string;
  contextHint?: string | null;
  warning?: string | null;
  emptyMessage?: string;
  filterText: string;
  onFilterTextChange: (value: string) => void;
  searchFields: RadPreviewSearchField[];
  onToggleSearchField: (field: RadPreviewSearchField) => void;
  exactMatch: boolean;
  onExactMatchChange: (value: boolean) => void;
  sortMode: RadPreviewSortMode;
  onSortModeChange: (value: RadPreviewSortMode) => void;
  showUnsupportedRules: boolean;
  onShowUnsupportedRulesChange: (value: boolean) => void;
  onSelectRadId: (radId: string | null) => void;
  onLegitimacyFlagChange: (flag: RadLegitimacyFlag) => void;
  loading: boolean;
  querying: boolean;
  searchActive: boolean;
  error: string | null;
  totalAvailable: number;
};

export default function RadPreviewRuleBrowserPanel({
  rows,
  selectedRadId,
  legitimacyFlag,
  title = "RAD Rules",
  contextHint,
  warning,
  emptyMessage,
  filterText,
  onFilterTextChange,
  searchFields,
  onToggleSearchField,
  exactMatch,
  onExactMatchChange,
  sortMode,
  onSortModeChange,
  showUnsupportedRules,
  onShowUnsupportedRulesChange,
  onSelectRadId,
  onLegitimacyFlagChange,
  loading,
  querying,
  searchActive,
  error,
  totalAvailable,
}: RadPreviewRuleBrowserPanelProps) {
  const resultSummary = searchActive
    ? `Showing ${rows.length.toLocaleString("en-US")} of ${totalAvailable.toLocaleString("en-US")} matching RADs.`
    : `Loaded ${rows.length.toLocaleString("en-US")} of ${totalAvailable.toLocaleString("en-US")} RADs.`;

  return (
    <div className="flex max-h-[calc(100vh-5rem)] w-full flex-col overflow-hidden rounded-2xl border border-white/20 bg-white/20 text-white shadow-xl backdrop-blur-md">
      <div className="shrink-0 p-4 border-b border-white/15">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-xs text-white/70">{resultSummary}</p>
            {contextHint && <p className="mt-1 text-[11px] text-white/55">{contextHint}</p>}
          </div>
          <div className="inline-flex rounded-lg border border-white/20 bg-white/10 p-1">
            <FlagButton
              active={legitimacyFlag === "L"}
              label="L"
              title="Preview legitimate flights"
              onClick={() => onLegitimacyFlagChange("L")}
            />
            <FlagButton
              active={legitimacyFlag === "I"}
              label="I"
              title="Preview illegitimate flights"
              onClick={() => onLegitimacyFlagChange("I")}
            />
          </div>
        </div>
      </div>
      <div className="shrink-0 p-4 border-b border-white/15">
        {warning && (
          <div className="rounded-lg border border-amber-300/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            {warning}
          </div>
        )}
        <div className={`group rounded-xl border border-white/10 bg-white/5 px-3 py-3 ${warning ? "mt-3" : ""}`}>
          <label className="sr-only" htmlFor="rad-preview-filter">
            Search RAD metadata
          </label>
          <input
            id="rad-preview-filter"
            type="search"
            value={filterText}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onFilterTextChange(event.currentTarget.value)}
            placeholder="Search airway, points, utilization..."
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:outline-none focus:ring-1 focus:ring-white/30"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/55">
            <span>Fields: {searchFields.join(", ")}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-white/65">
              {exactMatch ? "Exact match" : "Substring match"}
            </span>
            {querying && (
              <ShimmeringText
                text="Searching RAD metadata..."
                className="text-[11px] text-white/70 font-normal"
              />
            )}
          </div>
          <div className="grid max-h-0 overflow-hidden opacity-0 transition-all duration-200 ease-out group-focus-within:mt-3 group-focus-within:max-h-60 group-focus-within:opacity-100">
            <div className="text-[11px] uppercase text-white/40">Search fields</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {RAD_PREVIEW_SEARCH_FIELDS.map((field) => (
                <label
                  key={field}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/85"
                >
                  <input
                    type="checkbox"
                    checked={searchFields.includes(field)}
                    onChange={() => onToggleSearchField(field)}
                    className="h-4 w-4 cursor-pointer rounded border border-white/40 bg-white/10 accent-cyan-300"
                  />
                  <span>{field}</span>
                </label>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <div>
                <div className="text-xs font-medium text-white/85">Exact match</div>
                <div className="text-[11px] text-white/50">
                  Match whole trimmed field values instead of substrings.
                </div>
              </div>
              <ToggleSwitch
                checked={exactMatch}
                label="Exact match"
                onChange={onExactMatchChange}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 no-scrollbar">
        {loading && rows.length === 0 && (
          <div className="flex items-center justify-center py-8 text-sm text-white/70">
            {querying ? (
              <ShimmeringText
                text="Searching RAD metadata..."
                className="text-sm text-white/70 font-normal"
              />
            ) : (
              <>
                <Spinner />
                <ShimmeringText
                  text="Loading RAD previews..."
                  className="ml-2 text-sm font-normal text-white/70"
                />
              </>
            )}
          </div>
        )}
        {loading && rows.length > 0 && querying && (
          <div className="mb-3 rounded-lg border border-cyan-300/20 bg-cyan-400/5 px-3 py-2 text-xs text-cyan-100/80">
            <ShimmeringText
              text="Searching RAD metadata..."
              className="text-xs text-cyan-100/80 font-normal"
            />
          </div>
        )}
        {!loading && error && (
          <div className="rounded-lg border border-red-300/30 bg-red-500/10 px-3 py-3 text-sm text-red-100">
            {error}
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="py-8 text-center text-sm text-white/60">
            {searchActive ? "No RAD rows match the current search." : emptyMessage ?? "No RAD rows are available for this case."}
          </div>
        )}
        {!error && rows.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <div className="flex items-center gap-2">
                <label htmlFor="rad-preview-sort" className="text-xs font-medium text-white/75">
                  Sort
                </label>
                <select
                  id="rad-preview-sort"
                  value={sortMode}
                  onChange={(event) => onSortModeChange(event.currentTarget.value as RadPreviewSortMode)}
                  className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/30"
                >
                  <option value="default" className="bg-slate-900 text-white">
                    Default
                  </option>
                  <option value="L" className="bg-slate-900 text-white">
                    L flights
                  </option>
                  <option value="I" className="bg-slate-900 text-white">
                    I flights
                  </option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/75">Unsupported</span>
                <ToggleSwitch
                  checked={showUnsupportedRules}
                  label="Show unsupported RAD rules"
                  onChange={onShowUnsupportedRulesChange}
                />
              </div>
            </div>
            {rows.map((row) => {
              const isSelected = row.rad_id === selectedRadId;
              return (
                <button
                  key={row.rad_id}
                  type="button"
                  onClick={() => onSelectRadId(row.rad_id)}
                  className={`w-full rounded-xl border p-3 text-left transition-colors ${
                    isSelected
                      ? "border-cyan-300/60 bg-cyan-400/10"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-semibold">{row.rad_id}</div>
                      <div className="mt-1 text-[11px] text-white/60">
                        {row.total_instances} instance{row.total_instances === 1 ? "" : "s"} · first CSV row{" "}
                        {row.first_csv_row_number ?? "—"}
                      </div>
                    </div>
                    <SupportBadge status={row.support_status} />
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[11px]">
                    <CountChip
                      active={legitimacyFlag === "L"}
                      tone="emerald"
                      label={`L ${formatCount(row.flight_counts?.L)}`}
                    />
                    <CountChip
                      active={legitimacyFlag === "I"}
                      tone="rose"
                      label={`I ${formatCount(row.flight_counts?.I)}`}
                    />
                    <span className="ml-auto text-white/50">
                      supported {formatCount(row.supported_instance_count)} / {formatCount(row.total_instances)}
                    </span>
                  </div>
                  {row.relevance?.match_types && row.relevance.match_types.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-cyan-100/85">
                      {row.relevance.match_types.map((matchType) => (
                        <span
                          key={`${row.rad_id}-${matchType}`}
                          className="rounded-full border border-cyan-300/25 bg-cyan-400/10 px-2 py-0.5 capitalize"
                        >
                          {matchType}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
        checked
          ? "border-cyan-200/70 bg-cyan-300/80 hover:bg-cyan-300/90"
          : "border-white/30 bg-white/20 hover:bg-white/30"
      }`}
    >
      <span className="sr-only">{label}</span>
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function FlagButton({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`min-w-9 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
        active ? "bg-white text-[#0f172a]" : "text-white/75 hover:bg-white/10 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function SupportBadge({ status }: { status: string }) {
  if (status === "supported") {
    return (
      <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4 shrink-0 text-emerald-400" aria-label="Supported">
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.5" />
        <path d="M4.5 8.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "unsupported") {
    return (
      <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4 shrink-0 text-red-400" aria-label="Unsupported">
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.5" />
        <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4 shrink-0 text-amber-400" aria-label="Partial">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.5" />
      <path d="M8 5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11" r="0.75" fill="currentColor" />
    </svg>
  );
}

function CountChip({
  active,
  tone,
  label,
}: {
  active: boolean;
  tone: "emerald" | "rose";
  label: string;
}) {
  const activeClass =
    tone === "emerald"
      ? "border-emerald-300/40 bg-emerald-500/15 text-emerald-100"
      : "border-rose-300/40 bg-rose-500/15 text-rose-100";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 ${active ? activeClass : "border-white/10 bg-white/5 text-white/70"}`}
    >
      {label}
    </span>
  );
}

function Spinner() {
  return <div className="h-4 w-4 animate-spin rounded-full border border-white/20 border-t-white/80" />;
}

function formatCount(value: number | null | undefined): string {
  return Number.isFinite(value) ? Number(value).toLocaleString("en-US") : "0";
}
