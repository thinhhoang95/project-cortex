import type {
  RegulationPlanPerAccAttrib,
  RegulationPlanPerAccAttribMode,
} from "@/lib/models";
import { normalizePerAccAttribMode } from "@/lib/perAccAttribution";

export const PER_ACC_COMPARISON_MODES: RegulationPlanPerAccAttribMode[] = [
  "dwelling_spread",
  "control_volume",
];

export type StoredPerAccAttribByMode = Partial<
  Record<RegulationPlanPerAccAttribMode, RegulationPlanPerAccAttrib>
>;

function toFiniteNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function clonePerAccAttrib(
  attrib: RegulationPlanPerAccAttrib | null | undefined,
): RegulationPlanPerAccAttrib | null {
  if (!attrib || typeof attrib !== "object") return null;

  const delayMinutesByAcc = Object.entries(attrib.delay_minutes_by_acc || {}).reduce<Record<string, number>>(
    (acc, [key, rawValue]) => {
      const value = toFiniteNumber(rawValue);
      if (value !== null) {
        acc[String(key)] = value;
      }
      return acc;
    },
    {},
  );

  return {
    mode: normalizePerAccAttribMode(attrib.mode),
    delay_minutes_by_acc: delayMinutesByAcc,
    metadata: attrib.metadata ? { ...attrib.metadata } : undefined,
  };
}

export function sanitizeStoredPerAccAttribs(
  raw: unknown,
  fallback?: RegulationPlanPerAccAttrib | null | undefined,
): StoredPerAccAttribByMode | null {
  const result: StoredPerAccAttribByMode = {};

  const assign = (attrib: RegulationPlanPerAccAttrib | null | undefined) => {
    const cloned = clonePerAccAttrib(attrib);
    if (!cloned) return;
    result[normalizePerAccAttribMode(cloned.mode)] = cloned;
  };

  if (raw && typeof raw === "object") {
    for (const mode of PER_ACC_COMPARISON_MODES) {
      assign((raw as StoredPerAccAttribByMode)[mode]);
    }
    if (Object.keys(result).length === 0) {
      assign(raw as RegulationPlanPerAccAttrib);
    }
  }

  assign(fallback);

  return Object.keys(result).length > 0 ? result : null;
}
