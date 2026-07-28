"use client";

import { CircleAlert, CircleCheck, CircleX } from "lucide-react";
import type { ReactNode } from "react";

import PanelCloseButton from "@/components/PanelCloseButton";
import ShimmeringText from "@/components/ShimmeringText";
import type {
  PreviewRadFlightListResponse,
  RadLegitimacyFlag,
  RadPreviewInstance,
  RadPreviewRow,
} from "@/lib/radPreview";

type RadPreviewRuleDetailsPanelProps = {
  selectedRow: RadPreviewRow | null;
  selectedFlightList: PreviewRadFlightListResponse | null;
  legitimacyFlag: RadLegitimacyFlag;
  loading: boolean;
  error: string | null;
  onClose: () => void;
};

export default function RadPreviewRuleDetailsPanel({
  selectedRow,
  selectedFlightList,
  legitimacyFlag,
  loading,
  error,
  onClose,
}: RadPreviewRuleDetailsPanelProps) {
  if (!selectedRow) {
    return null;
  }

  const matchingIds = selectedRow.matching_rule_instance_ids_by_flag?.[legitimacyFlag] ?? [];

  return (
    <PanelShell
      title={selectedRow.rad_id}
      right={
        <div className="flex items-center gap-2">
          <SupportBadge status={selectedRow.support_status} />
          <PanelCloseButton
            onClick={onClose}
            ariaLabel="Deselect current RAD rule"
            title="Deselect RAD rule"
          />
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2 text-xs">
        <MetaCard label="Instances" value={selectedRow.total_instances} />
        <MetaCard label={`Flights (${legitimacyFlag})`} value={selectedFlightList?.count ?? selectedRow.flight_counts?.[legitimacyFlag] ?? 0} />
        <MetaCard label="First CSV Row" value={selectedRow.first_csv_row_number ?? "—"} />
        <MetaCard label="Supported" value={`${selectedRow.supported_instance_count}/${selectedRow.total_instances}`} />
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-white/85">Preview Status</span>
          {loading && (
            <ShimmeringText
              text="Loading flight list..."
              className="text-xs font-normal text-white/60"
            />
          )}
        </div>
        {!loading && error && <div className="mt-2 text-red-200">{error}</div>}
        {!loading && !error && (
          <div className="mt-2 space-y-1 text-white/70">
            <div>
              Matching instance ids for {legitimacyFlag}: {matchingIds.length > 0 ? matchingIds.join(", ") : "none"}
            </div>
            <div>
              Aggregated instance ids:{" "}
              {selectedRow.rule_instance_ids.length > 0 ? selectedRow.rule_instance_ids.join(", ") : "none"}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 space-y-3">
        <div className="text-xs font-medium uppercase tracking-wide text-white/60">Logical Instances</div>
        {selectedRow.instances.length === 0 ? (
          <div className="text-sm text-white/60">No instance metadata available.</div>
        ) : (
          selectedRow.instances.map((instance) => (
            <InstanceCard
              key={`${selectedRow.rad_id}-${instance.rule_instance_id}`}
              instance={instance}
              highlighted={matchingIds.includes(instance.rule_instance_id)}
            />
          ))
        )}
      </div>
    </PanelShell>
  );
}

function PanelShell({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col w-full rounded-2xl border border-white/20 bg-white/20 backdrop-blur-md shadow-xl text-white">
      <div className="flex items-center justify-between gap-3 border-b border-white/15 p-4">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{title}</h2>
        </div>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function MetaCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="text-[11px] uppercase tracking-wide text-white/55">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white/90">{value}</div>
    </div>
  );
}

function InstanceCard({ instance, highlighted }: { instance: RadPreviewInstance; highlighted: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3 text-xs ${
        highlighted ? "border-cyan-300/40 bg-cyan-400/10" : "border-white/10 bg-white/5"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-white/90">Instance {instance.rule_instance_id}</div>
          <div className="mt-1 text-white/60">
            CSV row {instance.csv_row_number ?? "—"} · {instance.effect || "No effect"}
          </div>
        </div>
        {instance.supported ? (
          <CircleCheck className="h-4 w-4 shrink-0 text-emerald-400" aria-label="Supported" />
        ) : (
          <CircleX className="h-4 w-4 shrink-0 text-red-400" aria-label="Unsupported" />
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-white/75">
        <Field label="Valid From" value={instance.valid_from} />
        <Field label="Valid Until" value={instance.valid_until} />
        <Field label="Airway" value={instance.airway} />
        <Field label="From" value={instance.from} />
        <Field label="To" value={instance.to} />
        <Field label="Point / Airspace" value={instance.point_or_airspace} />
        <Field label="Time Applicability" value={instance.time_applicability} splitOn="|" />
        <Field label="Utilization" value={instance.utilization} fullWidth splitOn="|" />
        <Field label="Operational Goal" value={instance.source_csv?.operational_goal} fullWidth splitOn="|" />
        <Field label="ATC Unit" value={instance.source_csv?.atc_unit} />
        <Field label="NAS / FAB" value={instance.source_csv?.nas_fab} />
        <Field label="Release Date" value={instance.source_csv?.release_date} />
        <Field label="Remarks" value={instance.source_csv?.remarks} fullWidth />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  fullWidth = false,
  splitOn,
}: {
  label: string;
  value: string | null | undefined;
  fullWidth?: boolean;
  splitOn?: string;
}) {
  const trimmed = value && String(value).trim().length > 0 ? String(value).trim() : null;
  const parts = trimmed && splitOn
    ? trimmed.split(splitOn).map((s) => s.trim()).filter((s) => s.length > 0)
    : null;

  return (
    <div className={fullWidth ? "col-span-2" : ""}>
      <div className="text-[11px] uppercase tracking-wide text-white/45">{label}</div>
      <div className="mt-0.5 break-words text-white/85">
        {parts ? parts.map((part, i) => /^-+$/.test(part) ? <div key={i} className="h-3" /> : <div key={i}>{part}</div>) : trimmed ?? "—"}
      </div>
    </div>
  );
}

function SupportBadge({ status }: { status: string }) {
  if (status === "supported") {
    return (
      <CircleCheck className="h-4 w-4 shrink-0 text-emerald-400" aria-label="Supported" />
    );
  }
  if (status === "unsupported") {
    return (
      <CircleX className="h-4 w-4 shrink-0 text-red-400" aria-label="Unsupported" />
    );
  }
  return (
    <CircleAlert className="h-4 w-4 shrink-0 text-amber-400" aria-label="Partial" />
  );
}
