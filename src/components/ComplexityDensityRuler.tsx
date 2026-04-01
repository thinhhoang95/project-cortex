"use client";

import { useId, useMemo } from "react";

import type { ComplexityDensityBand, ComplexityDensityRulerModel } from "@/lib/csComplexity";

type ComplexityDensityRulerProps = {
  model: ComplexityDensityRulerModel | null;
  active?: boolean;
  className?: string;
};

const BAND_COLOR: Record<ComplexityDensityBand, string> = {
  transparent: "#000000",
  yellow: "#facc15",
  orange: "#f97316",
  red: "#ef4444",
};

function formatDomainValue(value: number | null | undefined): string {
  const next = Number(value);
  if (!Number.isFinite(next)) return "—";
  if (Math.abs(next) >= 100 || Number.isInteger(next)) return String(Math.round(next));
  return next.toFixed(1);
}

export default function ComplexityDensityRuler({
  model,
  active = false,
  className,
}: ComplexityDensityRulerProps) {
  const clipId = useId();
  const gradientId = useId();
  const backgroundFill = active ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.06)";
  const strokeColor = active ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.14)";
  const sampleCount = model?.samples.length ?? 0;

  const gradientStops = useMemo(() => {
    if (!model || sampleCount === 0) return null;
    return model.samples.map((sample, index) => {
      const offset = sampleCount <= 1 ? 0 : index / (sampleCount - 1);
      const transparent = sample.band === "transparent";
      const opacity = transparent ? 0 : 0.45 + sample.normalizedDensity * 0.45;
      return { offset, color: BAND_COLOR[sample.band], opacity };
    });
  }, [model, sampleCount]);

  const observedRatio = model?.observedRatio ?? null;

  return (
    <div className={className}>
      <div className="relative">
        <svg viewBox="0 0 100 26" preserveAspectRatio="none" className="h-10 w-full overflow-visible">
          <defs>
            {gradientStops && (
              <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                {gradientStops.map(({ offset, color, opacity }, i) => (
                  <stop key={i} offset={`${(offset * 100).toFixed(2)}%`} stopColor={color} stopOpacity={opacity} />
                ))}
              </linearGradient>
            )}
            <clipPath id={clipId}>
              <rect x="0.75" y="2" width="98.5" height="12" rx="2.5" ry="2.5" />
            </clipPath>
          </defs>

          {/* Ruler background */}
          <rect x="0.75" y="2" width="98.5" height="12" rx="2.5" ry="2.5" fill={backgroundFill} />

          {/* Continuous color gradient */}
          {gradientStops && (
            <g clipPath={`url(#${clipId})`}>
              <rect x="0.75" y="2" width="98.5" height="12" fill={`url(#${gradientId})`} />
            </g>
          )}

          {/* Ruler border */}
          <rect x="0.75" y="2" width="98.5" height="12" rx="2.5" ry="2.5" fill="none" stroke={strokeColor} strokeWidth="0.8" />

          {/* Indicator triangle: below ruler, pointing upward */}
          {observedRatio !== null && (
            <polygon
              points={`${observedRatio * 98.5 + 0.75},18.5 ${observedRatio * 98.5 + 0.75 - 2.2},24 ${observedRatio * 98.5 + 0.75 + 2.2},24`}
              fill={active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.75)"}
            />
          )}
        </svg>

        {/* Observed value label, centered under the triangle */}
        {observedRatio !== null && (
          <div
            className="pointer-events-none absolute top-full -translate-x-1/2 text-[10px] leading-none text-white/60"
            style={{ left: `${observedRatio * 100}%` }}
          >
            {formatDomainValue(model?.observedValue)}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between text-[10px] text-white/40">
        <span>{formatDomainValue(model?.domainMin)}</span>
        <span>{formatDomainValue(model?.domainMax)}</span>
      </div>
    </div>
  );
}
