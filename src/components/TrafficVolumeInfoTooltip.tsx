"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SectorFeatureProps } from "@/lib/models";
import { fetchTrafficVolumeFeature, getCachedTrafficVolumeFeature } from "@/lib/trafficVolumes";
import TrafficVolumeMiniMap from "./TrafficVolumeMiniMap";

type TrafficVolumeInfoTooltipProps = {
  trafficVolumeId?: string | null;
  children: React.ReactNode;
  className?: string;
  tooltipClassName?: string;
  wrapperClassName?: string;
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
  wrapperClassName,
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
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const [portalNode, setPortalNode] = useState<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);

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

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCoords({
      left: rect.left + rect.width / 2,
      top: rect.bottom,
    });
  }, []);

  const handleOpen = () => {
    if (!normalizedId) return;
    updatePosition();
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    updatePosition();

    const handle = () => updatePosition();
    window.addEventListener("scroll", handle, true);
    window.addEventListener("resize", handle);

    return () => {
      window.removeEventListener("scroll", handle, true);
      window.removeEventListener("resize", handle);
    };
  }, [open, updatePosition, normalizedId]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const node = document.createElement("div");
    node.className = "traffic-volume-tooltip-portal";
    document.body.appendChild(node);
    setPortalNode(node);
    return () => {
      document.body.removeChild(node);
      setPortalNode(null);
    };
  }, []);

  if (!normalizedId) {
    return <>{children}</>;
  }

  const rootClassName = [
    "relative inline-flex min-w-0 max-w-full items-center",
    wrapperClassName,
  ]
    .filter(Boolean)
    .join(" ");

  const labelClassName = [
    "min-w-0 max-w-full",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const tooltipClass = [
    "pointer-events-none fixed z-[10050] rounded-xl border border-white/15 bg-slate-950/95 px-4 py-3 text-[11px] text-white/90 shadow-xl transition-opacity duration-150 backdrop-blur-sm",
    open ? "opacity-100" : "opacity-0",
    open ? "visible" : "invisible",
    tooltipClassName,
  ]
    .filter(Boolean)
    .join(" ");

  const formattedMin = formatFlightLevel(meta?.min_fl);
  const formattedMax = formatFlightLevel(meta?.max_fl);
  const showRange = formattedMin && formattedMax;
  const displayName = meta?.name?.trim() || "";
  const showVolumeIdDetail = Boolean(displayName && displayName !== normalizedId);

  return (
    <span
      ref={triggerRef}
      className={rootClassName}
      onMouseEnter={handleOpen}
      onMouseLeave={handleClose}
      onFocusCapture={handleOpen}
      onBlurCapture={handleClose}
    >
      <span className={labelClassName}>{children}</span>
      {portalNode &&
        createPortal(
          <div
            className={tooltipClass}
            role="status"
            aria-live="polite"
            style={{
              left: coords?.left ?? -9999,
              top: coords?.top ?? -9999,
              transform: "translate(-50%, 8px)",
              zIndex: 10050,
            }}
          >
            <div className="flex min-w-[320px] max-w-[520px] items-stretch gap-3">
              <div className="flex min-w-0 flex-1 flex-col text-left">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <span className="truncate">{displayName || normalizedId}</span>
                  {showVolumeIdDetail && (
                    <span className="truncate font-mono text-[10px] tracking-wide text-white/60">{normalizedId}</span>
                  )}
                </div>
                {status === "loading" && <span className="mt-2 text-white/60">Loading…</span>}
                {status === "error" && <span className="mt-2 text-rose-300">{error || "Not available"}</span>}
                {status === "ready" && (
                  <div className="mt-2 space-y-1 text-white/70">
                    {showVolumeIdDetail && (
                      <div className="flex items-center gap-2">
                        <span className="text-white/60">Volume ID</span>
                        <span className="font-mono text-white/80">{normalizedId}</span>
                      </div>
                    )}
                    {showRange && (
                      <div className="flex gap-2 flex-col">
                        <span className="text-white/60">Flight level</span>
                        <span className="font-mono text-white/80">
                          {formattedMin} – {formattedMax}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="flex-shrink-0">
                <div className="relative h-32 w-44 overflow-hidden rounded-lg border border-white/10 bg-slate-950/60">
                  {open ? (
                    <TrafficVolumeMiniMap
                      key={normalizedId}
                      trafficVolumeId={normalizedId}
                      className="h-full w-full"
                    />
                  ) : (
                    <div className="h-full w-full" />
                  )}
                </div>
              </div>
            </div>
          </div>,
          portalNode,
        )}
    </span>
  );
}
