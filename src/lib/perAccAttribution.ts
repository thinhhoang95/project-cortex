import type { RegulationPlanPerAccAttribMode } from "@/lib/models";

export const PER_ACC_ATTRIB_MODE_OPTIONS: Array<{ value: RegulationPlanPerAccAttribMode; label: string }> = [
  { value: "dwelling_spread", label: "Dwelling spread" },
  { value: "control_volume", label: "Control volume" },
];

export function normalizePerAccAttribMode(value: unknown): RegulationPlanPerAccAttribMode {
  return value === "control_volume" ? "control_volume" : "dwelling_spread";
}

