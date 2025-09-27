"use client";

import { useEffect, useMemo, useState } from "react";
import type { SectorFeatureProps } from "@/lib/models";
import { fetchTrafficVolumeFeature, getCachedTrafficVolumeFeature } from "@/lib/trafficVolumes";

type TrafficVolumeInfoTooltipProps = {
  trafficVolumeId?: string | null;
  children: React.ReactNode;
  className?: string;
  tooltipClassName?: string;
};

type TooltipStatus = "idle" | "loading" | "ready" | "error";

function normalizeId(id?: string | null): string {
  if (!id) return "";
  return String(id).trim();
}

function formatFlightLevel(fl: unknown): string | null {
  const num = Number(fl);
  if (!Number.isFinite(num)) return null;
  const rounded = Math.round(num);
  return `FL${rounded.toString().padStart(3, "0")}`;
}

export default function TrafficVolumeInfoTooltip({
  trafficVolumeId,
  children,
  className,
  tooltipClassName,
}: TrafficVolumeInfoTooltipProps) {
  const normalizedId = useMemo(() => normalizeId(trafficVolumeId), [trafficVolumeId]);
  const cached = useMemo(() => (normalizedId ? getCachedTrafficVolumeFeature(normalizedId)?.properties ?? null : null), [normalizedId]);

  const [status, setStatus] = useState<TooltipStatus>(() => {
    if (!normalizedId) return "idle";
    if (cached) return "ready";
    return "loading";
  });
  const [meta, setMeta] = useState<SectorFeatureProps | null>(() => cached);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!normalizedId) {
      setStatus("idle");
      setMeta(null);
      setError(null);
      return;
    }

    const cachedProps = getCachedTrafficVolumeFeature(normalizedId)?.properties ?? null;
    if (cachedProps) {
      setMeta(cachedProps);
      setStatus("ready");
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setError(null);

    fetchTrafficVolumeFeature(normalizedId)
      .then((feature) => {
        if (cancelled) return;
        if (feature?.properties) {
          setMeta(feature.properties);
          setStatus("ready");
        } else {
          setMeta(null);
          setStatus("error");
          setError("Traffic volume not found");
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        setMeta(null);
        setStatus("error");
        setError(err?.message || "Failed to load traffic volume");
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedId]);

  const handleOpen = () => {
    if (!normalizedId) return;
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
  };

  if (!normalizedId) {
    return <>{children}</>;
  }

  const rootClassName = [
    "relative inline-flex min-w-0 max-w-full items-center",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const tooltipClass = [
    "pointer-events-none absolute left-1/2 top-full z-50 -translate-x-1/2 translate-y-2 whitespace-nowrap rounded-lg border border-white/15 bg-slate-950/95 px-3 py-2 text-[11px] text-white/90 shadow-xl transition-opacity duration-150",
    open ? "opacity-100" : "opacity-0",
    open ? "visible" : "invisible",
    tooltipClassName,
  ]
    .filter(Boolean)
    .join(" ");

  const formattedMin = formatFlightLevel(meta?.min_fl);
  const formattedMax = formatFlightLevel(meta?.max_fl);
  const showRange = formattedMin && formattedMax;

  return (
    <span
      className={rootClassName}
      onMouseEnter={handleOpen}
      onMouseLeave={handleClose}
      onFocusCapture={handleOpen}
      onBlurCapture={handleClose}
    >
      <span className="min-w-0 max-w-full">{children}</span>
      <span className={tooltipClass} role="status" aria-live="polite">
        <span className="flex min-w-0 max-w-xs flex-col text-left">
          <span className="text-xs font-semibold text-white">{meta?.name?.trim() || normalizedId}</span>
          <span className="font-mono text-[11px] tracking-wide text-white/70">{normalizedId}</span>
          {status === "loading" && <span className="mt-1 text-white/60">Loading…</span>}
          {status === "error" && <span className="mt-1 text-rose-300">{error || "Not available"}</span>}
          {status === "ready" && showRange && (
            <span className="mt-1 text-emerald-300">
              {formattedMin} – {formattedMax}
            </span>
          )}
        </span>
      </span>
    </span>
  );
}
